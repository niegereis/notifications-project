import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { NotificationChannel } from '../../common/enums/notification-channel.enum.js';
import { MissingTemplateVariablesError, TemplateRenderer } from './template-renderer.js';
import { Template } from '../entities/template.entity.js';

export interface RenderedContent {
  templateId: string;
  subject: string | null;
  body: string;
}

/**
 * Por quanto tempo um template lido do banco vale antes de ser relido. Templates
 * só mudam por seed/migration, então o custo de um template editado levar até
 * esse tempo para aparecer em pedidos novos é menor que uma consulta por pedido.
 */
export const TEMPLATE_CACHE_TTL_MS = 60_000;

interface CachedTemplate {
  template: Promise<Template | null>;
  expiresAt: number;
}

@Injectable()
export class TemplatesService {
  private readonly cache = new Map<string, CachedTemplate>();

  constructor(
    @InjectRepository(Template)
    private readonly templates: Repository<Template>,
    private readonly renderer: TemplateRenderer,
  ) {}

  async renderForEvent(
    eventType: string,
    channel: NotificationChannel,
    payload: Record<string, unknown>,
  ): Promise<RenderedContent> {
    const template = await this.lookup(eventType, channel);

    if (!template) {
      throw new UnprocessableEntityException(
        `Não existe template para o evento "${eventType}" no canal ${channel.toLowerCase()}.`,
      );
    }

    try {
      return {
        templateId: template.id,
        subject: template.subject ? this.renderer.render(template.subject, payload) : null,
        body: this.renderer.render(template.body, payload),
      };
    } catch (error) {
      if (error instanceof MissingTemplateVariablesError) {
        throw new UnprocessableEntityException(error.message);
      }

      throw error;
    }
  }

  /**
   * Guarda a promessa, não só o resultado: pedidos simultâneos para o mesmo
   * template compartilham uma única consulta. Ausência e falha não ficam no
   * cache, para um template criado depois valer na hora e um erro de banco não
   * grudar.
   */
  private lookup(eventType: string, channel: NotificationChannel): Promise<Template | null> {
    const key = `${channel}:${eventType}`;
    const now = Date.now();
    const hit = this.cache.get(key);

    if (hit && hit.expiresAt > now) {
      return hit.template;
    }

    const entry: CachedTemplate = {
      template: this.templates.findOne({ where: { eventType, channel } }),
      expiresAt: now + TEMPLATE_CACHE_TTL_MS,
    };
    this.cache.set(key, entry);

    const forget = (): void => {
      if (this.cache.get(key) === entry) {
        this.cache.delete(key);
      }
    };
    entry.template.then((template) => (template ? undefined : forget()), forget);

    return entry.template;
  }
}
