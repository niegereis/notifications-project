import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';

import { NotificationChannel } from '../../common/enums/notification-channel.enum.js';
import {
  DeliveryError,
  type DeliveryProvider,
  type DeliveryRequest,
  type DeliveryResult,
} from '../types/delivery.types.js';

@Injectable()
export class EmailProvider implements DeliveryProvider {
  readonly channel = NotificationChannel.EMAIL;

  private readonly logger = new Logger(EmailProvider.name);
  private readonly transporter: Transporter;
  private readonly from: string;

  constructor(configService: ConfigService) {
    const user = configService.get<string>('SMTP_USER');
    const pass = configService.get<string>('SMTP_PASSWORD');

    this.from = configService.getOrThrow<string>('MAIL_FROM');
    this.transporter = createTransport({
      host: configService.getOrThrow<string>('SMTP_HOST'),
      port: configService.getOrThrow<number>('SMTP_PORT'),
      secure: configService.get<string>('SMTP_SECURE') === 'true',
      auth: user && pass ? { user, pass } : undefined,
    });
  }

  async send({ recipient, subject, body }: DeliveryRequest): Promise<DeliveryResult> {
    try {
      const info = await this.transporter.sendMail({
        from: this.from,
        to: recipient,
        subject: subject ?? '(sem assunto)',
        text: body,
      });

      return { providerMessageId: info.messageId };
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'erro desconhecido';
      this.logger.warn(`Falha ao enviar e-mail para ${recipient}: ${reason}`);

      throw new DeliveryError(`Provedor de e-mail recusou o envio: ${reason}`, error);
    }
  }
}
