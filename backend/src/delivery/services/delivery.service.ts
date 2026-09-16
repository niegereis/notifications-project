import { Inject, Injectable } from '@nestjs/common';

import { NotificationChannel } from '../../common/enums/notification-channel.enum.js';
import type { DeliveryProvider, DeliveryRequest, DeliveryResult } from '../types/delivery.types.js';
import { DELIVERY_STRATEGIES } from '../types/delivery.tokens.js';

@Injectable()
export class DeliveryService {
  private readonly providersByChannel: ReadonlyMap<NotificationChannel, DeliveryProvider>;

  constructor(@Inject(DELIVERY_STRATEGIES) strategies: DeliveryProvider[]) {
    this.providersByChannel = new Map(strategies.map((strategy) => [strategy.channel, strategy]));
  }

  supports(channel: NotificationChannel): boolean {
    return this.providersByChannel.has(channel);
  }

  send(channel: NotificationChannel, request: DeliveryRequest): Promise<DeliveryResult> {
    const provider = this.providersByChannel.get(channel);

    if (!provider) {
      throw new Error(`Nenhum provedor registrado para o canal ${channel}.`);
    }

    return provider.send(request);
  }
}
