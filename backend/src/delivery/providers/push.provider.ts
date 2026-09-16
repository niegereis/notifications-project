import { createSign, randomUUID } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { NotificationChannel } from '../../common/enums/notification-channel.enum.js';
import {
  DeliveryError,
  type DeliveryProvider,
  type DeliveryRequest,
  type DeliveryResult,
} from '../types/delivery.types.js';

const FCM_TIMEOUT_MS = 10_000;
const TOKEN_REFRESH_MARGIN_MS = 60_000;
const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

interface FcmCredentials {
  projectId: string;
  clientEmail: string;
  privateKey: string;
}

@Injectable()
export class PushProvider implements DeliveryProvider {
  readonly channel = NotificationChannel.PUSH;
  private readonly logger = new Logger(PushProvider.name);
  private cachedToken: { value: string; expiresAt: number } | null = null;

  constructor(private readonly config: ConfigService) {}

  send(request: DeliveryRequest): Promise<DeliveryResult> {
    const credentials = this.fcmCredentials();

    if (!credentials) {
      return this.simulate(request);
    }

    return this.sendViaFcm(request, credentials);
  }

  private fcmCredentials(): FcmCredentials | null {
    const projectId = this.config.get<string>('FCM_PROJECT_ID');
    const clientEmail = this.config.get<string>('FCM_CLIENT_EMAIL');
    const privateKey = this.config.get<string>('FCM_PRIVATE_KEY');

    if (!projectId || !clientEmail || !privateKey) {
      return null;
    }

    return { projectId, clientEmail, privateKey: normalizePem(privateKey) };
  }

  private simulate({ recipient, body }: DeliveryRequest): Promise<DeliveryResult> {
    const providerMessageId = `push-sim-${randomUUID()}`;
    this.logger.log(`Push simulado para ${recipient} (${providerMessageId}): ${body}`);

    return Promise.resolve({ providerMessageId });
  }

  private async sendViaFcm(
    { recipient, subject, body }: DeliveryRequest,
    credentials: FcmCredentials,
  ): Promise<DeliveryResult> {
    try {
      const accessToken = await this.accessToken(credentials);
      const url = `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(credentials.projectId)}/messages:send`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: {
            token: recipient,
            notification: {
              title: subject ?? 'Notificação',
              body,
            },
          },
        }),
        signal: AbortSignal.timeout(FCM_TIMEOUT_MS),
      });

      const payload: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        throw new DeliveryError(
          `Provedor de push recusou o envio: ${fcmErrorMessage(payload, response.status)}`,
        );
      }

      const name = fcmMessageNameOf(payload);

      if (!name) {
        throw new DeliveryError(
          'Provedor de push aceitou o envio mas não devolveu o nome da mensagem.',
        );
      }

      return { providerMessageId: name };
    } catch (error) {
      if (error instanceof DeliveryError) {
        throw error;
      }

      const reason = error instanceof Error ? error.message : 'erro desconhecido';
      this.logger.warn(`Falha ao enviar push para ${recipient}: ${reason}`);
      throw new DeliveryError(`Provedor de push recusou o envio: ${reason}`, error);
    }
  }

  private async accessToken(credentials: FcmCredentials): Promise<string> {
    if (this.cachedToken && this.cachedToken.expiresAt > Date.now() + TOKEN_REFRESH_MARGIN_MS) {
      return this.cachedToken.value;
    }

    const assertion = googleSignedJwt(credentials);
    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
      signal: AbortSignal.timeout(FCM_TIMEOUT_MS),
    });

    const payload: unknown = await response.json().catch(() => null);

    if (!response.ok) {
      throw new DeliveryError(
        `FCM recusou o token OAuth: ${fcmErrorMessage(payload, response.status)}`,
      );
    }

    const accessToken = accessTokenOf(payload);
    const expiresIn = expiresInOf(payload);

    if (!accessToken) {
      throw new DeliveryError('FCM não devolveu access_token.');
    }

    this.cachedToken = {
      value: accessToken,
      expiresAt: Date.now() + expiresIn * 1000,
    };

    return accessToken;
  }
}

function normalizePem(raw: string): string {
  return raw.replace(/\\n/g, '\n').replace(/^"(.*)"$/s, '$1');
}

function googleSignedJwt(credentials: FcmCredentials): string {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const claim = Buffer.from(
    JSON.stringify({
      iss: credentials.clientEmail,
      sub: credentials.clientEmail,
      aud: GOOGLE_TOKEN_URL,
      iat: now,
      exp: now + 3600,
      scope: FCM_SCOPE,
    }),
  ).toString('base64url');

  const unsigned = `${header}.${claim}`;
  const signature = createSign('RSA-SHA256')
    .update(unsigned)
    .sign(credentials.privateKey, 'base64url');

  return `${unsigned}.${signature}`;
}

function accessTokenOf(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null || !('access_token' in payload)) {
    return null;
  }

  return typeof payload.access_token === 'string' ? payload.access_token : null;
}

function expiresInOf(payload: unknown): number {
  if (typeof payload === 'object' && payload !== null && 'expires_in' in payload) {
    const value = payload.expires_in;

    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }

  return 3600;
}

function fcmMessageNameOf(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null || !('name' in payload)) {
    return null;
  }

  return typeof payload.name === 'string' && payload.name.length > 0 ? payload.name : null;
}

function fcmErrorMessage(payload: unknown, status: number): string {
  if (typeof payload === 'object' && payload !== null && 'error' in payload) {
    const error = payload.error;

    if (typeof error === 'object' && error !== null && 'message' in error) {
      const message = error.message;

      if (typeof message === 'string' && message.length > 0) {
        return message;
      }
    }
  }

  if (typeof payload === 'object' && payload !== null && 'error_description' in payload) {
    const description = payload.error_description;

    if (typeof description === 'string' && description.length > 0) {
      return description;
    }
  }

  return `HTTP ${status}`;
}
