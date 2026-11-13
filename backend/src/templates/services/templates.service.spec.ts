import { UnprocessableEntityException } from '@nestjs/common';
import type { Repository } from 'typeorm';

import { NotificationChannel } from '../../common/enums/notification-channel.enum.js';
import { Template } from '../entities/template.entity.js';
import { TemplateRenderer } from './template-renderer.js';
import { TEMPLATE_CACHE_TTL_MS, TemplatesService } from './templates.service.js';

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

  describe('cache', () => {
    function countingService(template: Partial<Template> | null) {
      const findOne = vi.fn(() => Promise.resolve(template));
      const repo = { findOne } as unknown as Repository<Template>;

      return { findOne, service: new TemplatesService(repo, new TemplateRenderer()) };
    }

    const found = { id: 'tpl-1', subject: null, body: 'Olá {{nome}}' };

    afterEach(() => {
      vi.useRealTimers();
    });

    it('consulta o banco uma vez para pedidos repetidos do mesmo template', async () => {
      const { service, findOne } = countingService(found);

      for (let i = 0; i < 5; i += 1) {
        await service.renderForEvent('user.welcome', NotificationChannel.EMAIL, { nome: 'Ana' });
      }

      expect(findOne).toHaveBeenCalledTimes(1);
    });

    it('compartilha a consulta entre pedidos simultâneos', async () => {
      const { service, findOne } = countingService(found);

      await Promise.all(
        Array.from({ length: 20 }, () =>
          service.renderForEvent('user.welcome', NotificationChannel.EMAIL, { nome: 'Ana' }),
        ),
      );

      expect(findOne).toHaveBeenCalledTimes(1);
    });

    it('separa por evento e por canal', async () => {
      const { service, findOne } = countingService(found);

      await service.renderForEvent('user.welcome', NotificationChannel.EMAIL, { nome: 'Ana' });
      await service.renderForEvent('user.welcome', NotificationChannel.SMS, { nome: 'Ana' });
      await service.renderForEvent('order.shipped', NotificationChannel.EMAIL, { nome: 'Ana' });

      expect(findOne).toHaveBeenCalledTimes(3);
    });

    it('relê o template depois que o TTL expira', async () => {
      vi.useFakeTimers();
      const { service, findOne } = countingService(found);

      await service.renderForEvent('user.welcome', NotificationChannel.EMAIL, { nome: 'Ana' });
      vi.advanceTimersByTime(TEMPLATE_CACHE_TTL_MS + 1);
      await service.renderForEvent('user.welcome', NotificationChannel.EMAIL, { nome: 'Ana' });

      expect(findOne).toHaveBeenCalledTimes(2);
    });

    it('não guarda a ausência: um template criado depois vale na hora', async () => {
      const findOne = vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'tpl-2', subject: null, body: 'Olá {{nome}}' });
      const service = new TemplatesService(
        { findOne } as unknown as Repository<Template>,
        new TemplateRenderer(),
      );

      await expect(
        service.renderForEvent('user.welcome', NotificationChannel.EMAIL, { nome: 'Ana' }),
      ).rejects.toThrow(UnprocessableEntityException);
      await expect(
        service.renderForEvent('user.welcome', NotificationChannel.EMAIL, { nome: 'Ana' }),
      ).resolves.toMatchObject({ templateId: 'tpl-2' });
    });

    it('não guarda falha de banco', async () => {
      const findOne = vi
        .fn()
        .mockRejectedValueOnce(new Error('conexão perdida'))
        .mockResolvedValueOnce(found);
      const service = new TemplatesService(
        { findOne } as unknown as Repository<Template>,
        new TemplateRenderer(),
      );

      await expect(
        service.renderForEvent('user.welcome', NotificationChannel.EMAIL, { nome: 'Ana' }),
      ).rejects.toThrow('conexão perdida');
      await expect(
        service.renderForEvent('user.welcome', NotificationChannel.EMAIL, { nome: 'Ana' }),
      ).resolves.toMatchObject({ templateId: 'tpl-1' });
    });
  });
});
