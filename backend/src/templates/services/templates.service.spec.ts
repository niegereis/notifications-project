import { UnprocessableEntityException } from '@nestjs/common';
import type { Repository } from 'typeorm';

import { NotificationChannel } from '../../common/enums/notification-channel.enum.js';
import { Template } from '../entities/template.entity.js';
import { TemplateRenderer } from './template-renderer.js';
import { TemplatesService } from './templates.service.js';

function serviceWith(template: Partial<Template> | null): TemplatesService {
  const templates = {
    findOne: () => Promise.resolve(template),
  } as unknown as Repository<Template>;

  return new TemplatesService(templates, new TemplateRenderer());
}

describe('TemplatesService', () => {
  it('recusa evento sem template no canal', async () => {
    const service = serviceWith(null);

    await expect(
      service.renderForEvent('user.welcome', NotificationChannel.EMAIL, { nome: 'Ana' }),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('renderiza subject e body com o payload', async () => {
    const service = serviceWith({
      id: 'tpl-1',
      subject: 'Olá {{nome}}',
      body: 'Conta {{produto}}',
    });

    await expect(
      service.renderForEvent('user.welcome', NotificationChannel.EMAIL, {
        nome: 'Ana',
        produto: 'Gateway',
      }),
    ).resolves.toEqual({
      templateId: 'tpl-1',
      subject: 'Olá Ana',
      body: 'Conta Gateway',
    });
  });

  it('propaga variável faltando como 422', async () => {
    const service = serviceWith({
      id: 'tpl-1',
      subject: null,
      body: 'Olá {{nome}}',
    });

    await expect(
      service.renderForEvent('user.welcome', NotificationChannel.EMAIL, {}),
    ).rejects.toThrow(UnprocessableEntityException);
  });
});
