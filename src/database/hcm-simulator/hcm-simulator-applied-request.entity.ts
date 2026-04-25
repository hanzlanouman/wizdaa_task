import { Column, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';

@Entity('hcm_simulator_applied_requests')
@Unique(['requestId'])
export class HcmSimulatorAppliedRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  requestId: string;

  @Column()
  payloadHash: string;

  @Column()
  hcmTransactionId: string;

  @Column('integer')
  resultingBalanceHundredths: number;
}
