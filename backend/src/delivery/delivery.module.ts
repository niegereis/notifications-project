import { Module } from '@nestjs/common';

import { DeliveryService } from './services/delivery.service.js';
import { DELIVERY_STRATEGIES } from './types/delivery.tokens.js';
import { EmailProvider } from './providers/email.provider.js';
import { PushProvider } from './providers/push.provider.js';
import { SmsProvider } from './providers/sms.provider.js';

@Module({
  providers: [
    EmailProvider,
    SmsProvider,
    PushProvider,
    {
      provide: DELIVERY_STRATEGIES,
      useFactory: (email: EmailProvider, sms: SmsProvider, push: PushProvider) => [
        email,
        sms,
        push,
      ],
      inject: [EmailProvider, SmsProvider, PushProvider],
    },
    DeliveryService,
  ],
  exports: [DeliveryService],
})
export class DeliveryModule {}
