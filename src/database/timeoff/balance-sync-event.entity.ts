import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { SyncStatus } from '../../common/status.enum';

@Entity('balance_sync_events')
@Unique(['batchId'])
export class BalanceSyncEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  batchId: string;

  @Column()
  payloadHash: string;

  @Column('integer')
  recordsReceived: number;

  @Column('integer')
  recordsUpserted: number;

  @Column({ type: 'text' })
  status: SyncStatus;

  @Column({ nullable: true })
  errorMessage?: string;

  @CreateDateColumn()
  createdAt: Date;
}
