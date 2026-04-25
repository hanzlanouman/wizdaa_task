import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { TimeOffRequestStatus } from '../../common/status.enum';

@Entity('time_off_requests')
@Index(['employeeId', 'locationId', 'status'])
@Index(['idempotencyKey'], { unique: true })
export class TimeOffRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  employeeId: string;

  @Column()
  locationId: string;

  @Column('integer')
  daysHundredths: number;

  @Column({ nullable: true })
  startDate?: string;

  @Column({ nullable: true })
  endDate?: string;

  @Column({ nullable: true })
  reason?: string;

  @Column({ type: 'text' })
  status: TimeOffRequestStatus;

  @Column()
  requestedBy: string;

  @Column({ nullable: true })
  decidedBy?: string;

  @Column({ type: 'datetime', nullable: true })
  decidedAt?: Date;

  @Column({ nullable: true })
  hcmTransactionId?: string;

  @Column({ nullable: true })
  idempotencyKey?: string;

  @Column({ nullable: true })
  idempotencyPayloadHash?: string;

  @Column({ nullable: true })
  approvalAttemptId?: string;

  @Column({ type: 'datetime', nullable: true })
  approvalStartedAt?: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
