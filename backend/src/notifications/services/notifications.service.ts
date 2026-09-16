import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { NotificationStatus } from '../../common/enums/notification-status.enum.js';
import { DeliveryService } from '../../delivery/services/delivery.service.js';
import { AmqpService } from '../../messaging/services/amqp.service.js';
import { NotificationPublisher } from '../../messaging/publishers/notification.publisher.js';
import { MetricsService } from '../../metrics/services/metrics.service.js';
import { TemplatesService } from '../../templates/services/templates.service.js';
import type { CreateNotificationDto } from '../dto/create-notification.dto.js';
import type { ListNotificationsQueryDto } from '../dto/list-notifications.query.js';
import { fingerprintOf } from '../dto/request-fingerprint.js';
import { IdempotencyService } from './idempotency.service.js';
import { Notification } from '../entities/notification.entity.js';
import { RateLimitService } from './rate-limit.service.js';

const MAX_IDEMPOTENCY_KEY_LENGTH = 255;

export interface NotificationPage {
  items: Notification[];
  page: number;
  pageSize: number;
  total: number;
}

export interface DeadRedriveResult {
  redriven: string[];
  discarded: number;
  returned: number;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectRepository(Notification)
    private readonly notifications: Repository<Notification>,
    private readonly templates: TemplatesService,
    private readonly delivery: DeliveryService,
    private readonly publisher: NotificationPublisher,
    private readonly idempotency: IdempotencyService,
    private readonly rateLimit: RateLimitService,
    private readonly metrics: MetricsService,
    private readonly amqp: AmqpService,
  ) {}

  async create(
    dto: CreateNotificationDto,
    requestedBy: string,
    idempotencyKey?: string,
  ): Promise<Notification> {
    const key = this.normalizedIdempotencyKey(idempotencyKey);

    if (key) {
      const reservation = await this.idempotency.reserve(requestedBy, key, fingerprintOf(dto));

      if (reservation.kind === 'replay') {
        const previous = await this.findOne(reservation.notificationId, requestedBy);
        this.metrics.recordReplay(previous.channel);
        return previous;
      }
    }

    let holdReservation = Boolean(key);

    try {
      await this.rateLimit.consume(dto.channel, dto.recipient);

      if (!this.delivery.supports(dto.channel)) {
        throw new UnprocessableEntityException(
          `O canal ${dto.channel.toLowerCase()} ainda não tem provedor configurado.`,
        );
      }

      const payload = dto.payload ?? {};
      const rendered = await this.templates.renderForEvent(dto.eventType, dto.channel, payload);

      const notification = await this.notifications.save(
        this.notifications.create({
          channel: dto.channel,
          eventType: dto.eventType,
          recipient: dto.recipient,
          payload,
          requestedBy,
          templateId: rendered.templateId,
          subject: rendered.subject,
          body: rendered.body,
          callbackUrl: dto.callbackUrl ?? null,
          status: NotificationStatus.PENDING,
        }),
      );

      try {
        await this.publisher.publish(notification);
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'erro desconhecido';
        this.logger.error(`Não foi possível enfileirar ${notification.id}: ${reason}`);

        await this.notifications.update(notification.id, {
          status: NotificationStatus.FAILED,
          failureReason: `Não foi possível enfileirar a notificação: ${reason}`,
        });

        this.metrics.recordEnqueueFailed(notification.channel);

        throw new ServiceUnavailableException(
          'Não foi possível enfileirar a notificação. Tente de novo.',
        );
      }

      if (key) {
        await this.idempotency.commit(requestedBy, key, notification.id);
        holdReservation = false;
      }

      this.metrics.recordAccepted(notification.channel);

      return this.findOne(notification.id, requestedBy);
    } catch (error) {
      if (key && holdReservation) {
        await this.idempotency.release(requestedBy, key);
      }

      throw error;
    }
  }

  async findOne(id: string, requestedBy: string): Promise<Notification> {
    const notification = await this.notifications.findOne({
      where: { id, requestedBy },
      relations: { attempts: true },
      order: { attempts: { attemptNumber: 'ASC' } },
    });

    if (!notification) {
      throw new NotFoundException(`Notificação ${id} não encontrada.`);
    }

    return notification;
  }

  async list(requestedBy: string, query: ListNotificationsQueryDto): Promise<NotificationPage> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const [items, total] = await this.notifications.findAndCount({
      where: {
        requestedBy,
        ...(query.status ? { status: query.status } : {}),
        ...(query.channel ? { channel: query.channel } : {}),
        ...(query.recipient ? { recipient: query.recipient } : {}),
      },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    return { items, page, pageSize, total };
  }

  async redrive(id: string, requestedBy: string): Promise<Notification> {
    const notification = await this.findOne(id, requestedBy);

    if (notification.status !== NotificationStatus.FAILED) {
      throw new ConflictException('Só é possível reprocessar notificação com status FAILED.');
    }

    await this.enqueueRedrive(notification);
    return this.findOne(id, requestedBy);
  }

  async redriveDead(requestedBy: string, limit = 50): Promise<DeadRedriveResult> {
    const pulled = await this.amqp.pullDead(limit);
    const redriven: string[] = [];
    let discarded = 0;
    let returned = 0;

    for (const message of pulled) {
      const notification = await this.notifications.findOne({
        where: { id: message.notificationId },
      });

      if (!notification || notification.status === NotificationStatus.SENT) {
        discarded += 1;
        continue;
      }

      if (
        notification.requestedBy !== requestedBy ||
        notification.status !== NotificationStatus.FAILED
      ) {
        await this.amqp.publishDead(message);
        returned += 1;
        continue;
      }

      await this.enqueueRedrive(notification);
      redriven.push(notification.id);
    }

    return { redriven, discarded, returned };
  }

  private async enqueueRedrive(notification: Notification): Promise<void> {
    const previousReason = notification.failureReason;
    const previousCycle = notification.deliveryCycle ?? 0;
    const nextCycle = previousCycle + 1;

    const claimed = await this.notifications.update(
      {
        id: notification.id,
        requestedBy: notification.requestedBy,
        status: NotificationStatus.FAILED,
      },
      {
        status: NotificationStatus.PENDING,
        failureReason: null,
        sentAt: null,
        deliveryCycle: nextCycle,
      },
    );

    if (claimed.affected === 0) {
      throw new ConflictException('Só é possível reprocessar notificação com status FAILED.');
    }

    try {
      await this.publisher.publish(notification);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'erro desconhecido';
      this.logger.error(`Não foi possível reenfileirar ${notification.id}: ${reason}`);

      await this.notifications.update(notification.id, {
        status: NotificationStatus.FAILED,
        failureReason: previousReason,
        deliveryCycle: previousCycle,
      });

      throw new ServiceUnavailableException(
        'Não foi possível reenfileirar a notificação. Tente de novo.',
      );
    }

    this.metrics.recordRedriven(notification.channel);
  }

  private normalizedIdempotencyKey(raw?: string): string | undefined {
    if (raw === undefined) {
      return undefined;
    }

    const key = raw.trim();

    if (key.length === 0 || key.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
      throw new BadRequestException(
        `Idempotency-Key deve ter entre 1 e ${MAX_IDEMPOTENCY_KEY_LENGTH} caracteres.`,
      );
    }

    return key;
  }
}
