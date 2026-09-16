import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  type Relation,
  UpdateDateColumn,
} from 'typeorm';

import { NotificationChannel } from '../../common/enums/notification-channel.enum.js';
import { NotificationStatus } from '../../common/enums/notification-status.enum.js';
import { Template } from '../../templates/entities/template.entity.js';
import { DeliveryAttempt } from './delivery-attempt.entity.js';

@Entity('notifications')
@Index('idx_notifications_status_created_at', ['status', 'createdAt'])
@Index('idx_notifications_channel_status', ['channel', 'status'])
@Index('idx_notifications_recipient', ['recipient'])
@Index('idx_notifications_created_at', ['createdAt'])
@Index('idx_notifications_requested_by_created_at', ['requestedBy', 'createdAt'])
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'enum', enum: NotificationChannel, enumName: 'notification_channel' })
  channel: NotificationChannel;

  @Column({ name: 'event_type', type: 'varchar', length: 100 })
  eventType: string;

  @Column({ type: 'varchar', length: 255 })
  recipient: string;

  @Column({ type: 'jsonb', default: {} })
  payload: Record<string, unknown>;

  @Column({
    type: 'enum',
    enum: NotificationStatus,
    enumName: 'notification_status',
    default: NotificationStatus.PENDING,
  })
  status: NotificationStatus;

  @Column({ name: 'requested_by', type: 'varchar', length: 100 })
  requestedBy: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  subject: string | null;

  @Column({ type: 'text' })
  body: string;

  @Column({ name: 'callback_url', type: 'varchar', length: 2048, nullable: true })
  callbackUrl: string | null;

  @Column({ name: 'delivery_cycle', type: 'int', default: 0 })
  deliveryCycle: number;

  @Column({ name: 'failure_reason', type: 'text', nullable: true })
  failureReason: string | null;

  @Column({ name: 'sent_at', type: 'timestamptz', nullable: true })
  sentAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @Column({ name: 'template_id', type: 'uuid', nullable: true })
  templateId: string | null;

  @ManyToOne(() => Template, (template) => template.notifications, {
    onDelete: 'SET NULL',
    nullable: true,
  })
  @JoinColumn({ name: 'template_id' })
  template: Relation<Template> | null;

  @OneToMany(() => DeliveryAttempt, (attempt) => attempt.notification)
  attempts: Relation<DeliveryAttempt>[];
}
