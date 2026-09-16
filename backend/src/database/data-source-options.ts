import type { DataSourceOptions } from 'typeorm';

import { DeliveryAttempt } from '../notifications/entities/delivery-attempt.entity.js';
import { Notification } from '../notifications/entities/notification.entity.js';
import { Template } from '../templates/entities/template.entity.js';

export function buildDataSourceOptions(databaseUrl: string): DataSourceOptions {
  return {
    type: 'postgres',
    url: databaseUrl,
    entities: [Notification, DeliveryAttempt, Template],
    synchronize: false,
    migrationsRun: false,
  };
}
