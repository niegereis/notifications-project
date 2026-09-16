import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  type Relation,
  UpdateDateColumn,
} from 'typeorm';

import { NotificationChannel } from '../../common/enums/notification-channel.enum.js';
import { Notification } from '../../notifications/entities/notification.entity.js';

@Entity('templates')
@Index('uq_templates_event_channel', ['eventType', 'channel'], { unique: true })
export class Template {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'event_type', type: 'varchar', length: 100 })
  eventType: string;

  @Column({ type: 'enum', enum: NotificationChannel, enumName: 'notification_channel' })
  channel: NotificationChannel;

  @Column({ type: 'varchar', length: 255, nullable: true })
  subject: string | null;

  @Column({ type: 'text' })
  body: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @OneToMany(() => Notification, (notification) => notification.template)
  notifications: Relation<Notification>[];
}
