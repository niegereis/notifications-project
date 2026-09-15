import 'reflect-metadata';

import { Environment, validateEnv } from './env.validation.js';

const valid = {
  NODE_ENV: 'test',
  PORT: '3000',
  DATABASE_URL: 'postgresql://notifications:notifications@localhost:5432/notifications',
  REDIS_URL: 'redis://localhost:6379',
  RABBITMQ_URL: 'amqp://notifications:notifications@localhost:5672',
  API_KEYS: 'billing:sk_testechavecompridasuficiente',
  SMTP_HOST: 'localhost',
  SMTP_PORT: '1025',
  MAIL_FROM: 'Gateway <no-reply@notifications.local>',
};

describe('validateEnv', () => {
  it('aceita a configuração mínima válida', () => {
    const env = validateEnv(valid);

    expect(env.NODE_ENV).toBe(Environment.Test);
    expect(env.PORT).toBe(3000);
    expect(env.SMTP_PORT).toBe(1025);
  });

  it('aplica os defaults de idempotência e rate limit quando omitidos', () => {
    const env = validateEnv(valid);

    expect(env.IDEMPOTENCY_TTL_SECONDS).toBeUndefined();
    expect(env.RATE_LIMIT_MAX).toBeUndefined();
    expect(env.RATE_LIMIT_WINDOW_SECONDS).toBeUndefined();
    expect(env.METRICS_PORT).toBeUndefined();
  });

  it('aceita a porta de métricas do worker', () => {
    const env = validateEnv({ ...valid, METRICS_PORT: '9464' });

    expect(env.METRICS_PORT).toBe(9464);
  });

  it('recusa variável obrigatória faltando', () => {
    const incomplete: Record<string, unknown> = { ...valid };
    delete incomplete.DATABASE_URL;

    expect(() => validateEnv(incomplete)).toThrow(/DATABASE_URL/);
  });

  it('recusa RabbitMQ que não seja amqp', () => {
    expect(() => validateEnv({ ...valid, RABBITMQ_URL: 'http://localhost:5672' })).toThrow(
      /RABBITMQ_URL/,
    );
  });

  it('recusa teto de rate limit inválido', () => {
    expect(() => validateEnv({ ...valid, RATE_LIMIT_MAX: '0' })).toThrow(/RATE_LIMIT_MAX/);
  });

  it('trata credencial em branco como omitida', () => {
    const env = validateEnv({ ...valid, TWILIO_ACCOUNT_SID: '  ' });

    expect(env.TWILIO_ACCOUNT_SID).toBeUndefined();
  });

  it('recusa WEBHOOK_SECRET curto demais', () => {
    expect(() => validateEnv({ ...valid, WEBHOOK_SECRET: 'curto' })).toThrow(/WEBHOOK_SECRET/);
  });
});
