import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('request_events')
export class RequestEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ nullable: true })
  requestId?: string;

  @Column()
  eventType: string;

  @Column({ nullable: true })
  actorId?: string;

  @Column({ nullable: true })
  message?: string;

  @Column({ type: 'text', nullable: true })
  metadataJson?: string;

  @CreateDateColumn()
  createdAt: Date;
}
