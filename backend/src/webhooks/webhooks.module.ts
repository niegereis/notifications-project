import { Module } from '@nestjs/common';

import { WebhookDispatcher } from './services/webhook.dispatcher.js';

@Module({
  providers: [WebhookDispatcher],
  exports: [WebhookDispatcher],
})
export class WebhooksModule {}
