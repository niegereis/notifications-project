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

@Injectable()
export class TemplatesService {
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
    const template = await this.templates.findOne({ where: { eventType, channel } });

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
}
