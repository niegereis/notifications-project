import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

import { NotificationChannel } from '../../common/enums/notification-channel.enum.js';
import { NotificationStatus } from '../../common/enums/notification-status.enum.js';

export class ListNotificationsQueryDto {
  @IsOptional()
  @IsEnum(NotificationStatus, {
    message: `status deve ser um destes: ${Object.values(NotificationStatus).join(', ')}.`,
  })
  status?: NotificationStatus;

  @IsOptional()
  @IsEnum(NotificationChannel, {
    message: `channel deve ser um destes: ${Object.values(NotificationChannel).join(', ')}.`,
  })
  channel?: NotificationChannel;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  recipient?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;
}
