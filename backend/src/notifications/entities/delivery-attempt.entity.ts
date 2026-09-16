import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  type Relation,
} from 'typeorm';

import { DeliveryAttemptStatus } from '../../common/enums/delivery-attempt-status.enum.js';
import { Notification } from './notification.entity.js';

@Entity('delivery_attempts')
@Index(
  'uq_delivery_attempts_notification_cycle_number',
  ['notificationId', 'cycle', 'attemptNumber'],
  {
    unique: true,
  },
)
@Index('idx_delivery_attempts_notification', ['notificationId'])
export class DeliveryAttempt {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'notification_id', type: 'uuid' })
  notificationId: string;

  @ManyToOne(() => Notification, (notification) => notification.attempts, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'notification_id' })
  // Relation<> evita que o metadata do decorator toque a classe durante o
  // ciclo de imports entre as duas entidades.
  notification: Relation<Notification>;

  @Column({ name: 'attempt_number', type: 'int' })
  attemptNumber: number;

  @Column({ type: 'int', default: 0 })
  cycle: number;

  @Column({ type: 'enum', enum: DeliveryAttemptStatus, enumName: 'delivery_attempt_status' })
  status: DeliveryAttemptStatus;

  @Column({ name: 'provider_message_id', type: 'varchar', length: 255, nullable: true })
  providerMessageId: string | null;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @Column({ name: 'duration_ms', type: 'int' })
  durationMs: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
