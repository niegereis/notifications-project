const TEST_DATABASE_URL_DEFAULT =
  'postgresql://notifications:notifications@localhost:5432/notifications_test';

export const TEST_CLIENT_NAME = 'servico-de-teste';
export const TEST_API_KEY = 'chave-de-teste-com-tamanho-suficiente';
export const OTHER_CLIENT_NAME = 'outro-servico';
export const OTHER_API_KEY = 'chave-do-outro-servico-de-teste';

process.env.NODE_ENV = 'test';
process.env.PORT = process.env.PORT ?? '3000';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? TEST_DATABASE_URL_DEFAULT;
process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379/1';
process.env.RATE_LIMIT_MAX = process.env.RATE_LIMIT_MAX ?? '3';
process.env.RATE_LIMIT_WINDOW_SECONDS = process.env.RATE_LIMIT_WINDOW_SECONDS ?? '60';
process.env.RABBITMQ_URL =
  process.env.RABBITMQ_URL ?? 'amqp://notifications:notifications@localhost:5672';
process.env.API_KEYS = `${TEST_CLIENT_NAME}:${TEST_API_KEY},${OTHER_CLIENT_NAME}:${OTHER_API_KEY}`;
process.env.SMTP_HOST = process.env.SMTP_HOST ?? 'localhost';
process.env.SMTP_PORT = process.env.SMTP_PORT ?? '1025';
process.env.MAIL_FROM = process.env.MAIL_FROM ?? 'Testes <no-reply@notifications.test>';
process.env.WEBHOOK_SECRET = process.env.WEBHOOK_SECRET ?? 'webhook-test-secret';
