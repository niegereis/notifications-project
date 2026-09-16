import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';

import type { ApiClient } from '../../auth/types/api-key.types.js';
import { CurrentClient } from '../../auth/decorators/current-client.decorator.js';
import { CreateNotificationDto } from '../dto/create-notification.dto.js';
import { ListNotificationsQueryDto } from '../dto/list-notifications.query.js';
import { RedriveDeadDto } from '../dto/redrive-dead.dto.js';
import {
  type NotificationPageResponse,
  type NotificationResponse,
  toNotificationResponse,
} from '../mappers/notification.response.js';
import { NotificationsService } from '../services/notifications.service.js';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async create(
    @Body() dto: CreateNotificationDto,
    @CurrentClient() client: ApiClient,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<NotificationResponse> {
    return toNotificationResponse(
      await this.notifications.create(dto, client.name, idempotencyKey),
    );
  }

  @Get()
  async list(
    @Query() query: ListNotificationsQueryDto,
    @CurrentClient() client: ApiClient,
  ): Promise<NotificationPageResponse> {
    const page = await this.notifications.list(client.name, query);

    return {
      items: page.items.map((notification) => toNotificationResponse(notification)),
      page: page.page,
      pageSize: page.pageSize,
      total: page.total,
    };
  }

  @Post('dead/redrive')
  @HttpCode(HttpStatus.ACCEPTED)
  redriveDead(
    @CurrentClient() client: ApiClient,
    @Body() dto: RedriveDeadDto = {},
  ): Promise<{ redriven: string[]; discarded: number; returned: number }> {
    return this.notifications.redriveDead(client.name, dto.limit);
  }

  @Post(':id/redrive')
  @HttpCode(HttpStatus.ACCEPTED)
  async redrive(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentClient() client: ApiClient,
  ): Promise<NotificationResponse> {
    return toNotificationResponse(await this.notifications.redrive(id, client.name));
  }

  @Get(':id')
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentClient() client: ApiClient,
  ): Promise<NotificationResponse> {
    return toNotificationResponse(await this.notifications.findOne(id, client.name));
  }
}
