import { IsEnum, IsObject, IsOptional, IsString, IsUrl, Matches, MaxLength } from 'class-validator';

import { NotificationChannel } from '../../common/enums/notification-channel.enum.js';
import { IsValidRecipient } from './is-valid-recipient.validator.js';

export class CreateNotificationDto {
  @IsEnum(NotificationChannel, {
    message: `channel deve ser um destes: ${Object.values(NotificationChannel).join(', ')}.`,
  })
  channel: NotificationChannel;

  @IsString()
  @MaxLength(100)
  @Matches(/^[a-z0-9]+(\.[a-z0-9]+)+$/, {
    message: 'eventType deve seguir o formato dominio.evento, ex.: order.shipped.',
  })
  eventType: string;

  @IsString()
  @MaxLength(255)
  @IsValidRecipient()
  recipient: string;

  @IsObject()
  @IsOptional()
  payload?: Record<string, unknown>;

  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_tld: false, require_protocol: true })
  @MaxLength(2048)
  callbackUrl?: string;
}
