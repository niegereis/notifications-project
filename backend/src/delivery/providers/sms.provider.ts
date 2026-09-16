import { randomUUID } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { NotificationChannel } from '../../common/enums/notification-channel.enum.js';
import {
  DeliveryError,
  type DeliveryProvider,
  type DeliveryRequest,
  type DeliveryResult,
} from '../types/delivery.types.js';

const TWILIO_TIMEOUT_MS = 10_000;

@Injectable()
export class SmsProvider implements DeliveryProvider {
  readonly channel = NotificationChannel.SMS;
  private readonly logger = new Logger(SmsProvider.name);

  constructor(private readonly config: ConfigService) {}

  send(request: DeliveryRequest): Promise<DeliveryResult> {
    const credentials = this.twilioCredentials();

    if (!credentials) {
      return this.simulate(request);
    }

    return this.sendViaTwilio(request, credentials);
  }

  private twilioCredentials(): { sid: string; token: string; from: string } | null {
    const sid = this.config.get<string>('TWILIO_ACCOUNT_SID');
    const token = this.config.get<string>('TWILIO_AUTH_TOKEN');
    const from = this.config.get<string>('TWILIO_FROM');

    if (!sid || !token || !from) {
      return null;
    }

    return { sid, token, from };
  }

  private simulate({ recipient, body }: DeliveryRequest): Promise<DeliveryResult> {
    const providerMessageId = `sms-sim-${randomUUID()}`;
    this.logger.log(`SMS simulado para ${recipient} (${providerMessageId}): ${body}`);

    return Promise.resolve({ providerMessageId });
  }

  private async sendViaTwilio(
    { recipient, body }: DeliveryRequest,
    credentials: { sid: string; token: string; from: string },
  ): Promise<DeliveryResult> {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(credentials.sid)}/Messages.json`;
    const authorization = Buffer.from(`${credentials.sid}:${credentials.token}`).toString('base64');

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${authorization}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          From: credentials.from,
          To: recipient,
          Body: body,
        }),
        signal: AbortSignal.timeout(TWILIO_TIMEOUT_MS),
      });

      const payload: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        throw new DeliveryError(
          `Provedor de SMS recusou o envio: ${twilioErrorMessage(payload, response.status)}`,
        );
      }

      const sid = messageSidOf(payload);

      if (!sid) {
        throw new DeliveryError('Provedor de SMS aceitou o envio mas não devolveu sid.');
      }

      return { providerMessageId: sid };
    } catch (error) {
      if (error instanceof DeliveryError) {
        throw error;
      }

      const reason = error instanceof Error ? error.message : 'erro desconhecido';
      this.logger.warn(`Falha ao enviar SMS para ${recipient}: ${reason}`);
      throw new DeliveryError(`Provedor de SMS recusou o envio: ${reason}`, error);
    }
  }
}

function messageSidOf(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null || !('sid' in payload)) {
    return null;
  }

  return typeof payload.sid === 'string' && payload.sid.length > 0 ? payload.sid : null;
}

function twilioErrorMessage(payload: unknown, status: number): string {
  if (typeof payload === 'object' && payload !== null && 'message' in payload) {
    const message = payload.message;

    if (typeof message === 'string' && message.length > 0) {
      return message;
    }
  }

  return `HTTP ${status}`;
}
