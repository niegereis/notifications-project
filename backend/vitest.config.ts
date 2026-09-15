import { defineConfig, mergeConfig } from 'vitest/config';

import sharedConfig from './vitest.shared.js';

export default mergeConfig(
  sharedConfig,
  defineConfig({
    test: {
      include: ['src/**/*.spec.ts'],
      coverage: {
        reporter: ['text', 'lcov'],
        include: ['src/**/*.ts'],
        exclude: [
          'src/**/*.spec.ts',
          'src/main.ts',
          'src/worker.ts',
          'src/**/*.module.ts',
          'src/**/*.entity.ts',
          'src/**/*.controller.ts',
          'src/database/**',
          'src/common/enums/**',
          'src/auth/decorators/current-client.decorator.ts',
          'src/delivery/types/delivery.tokens.ts',
          'src/delivery/providers/email.provider.ts',
          'src/messaging/services/amqp.service.ts',
          'src/messaging/publishers/notification.publisher.ts',
          'src/metrics/services/metrics.http-server.ts',
          'src/notifications/dto/create-notification.dto.ts',
          'src/notifications/dto/list-notifications.query.ts',
          'src/redis/services/redis.service.ts',
        ],
        thresholds: {
          statements: 85,
          branches: 75,
          functions: 85,
          lines: 85,
        },
      },
    },
  }),
);
