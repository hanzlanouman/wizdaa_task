import { Column, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';

@Entity('hcm_simulator_balances')
@Unique(['employeeId', 'locationId'])
export class HcmSimulatorBalance {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  employeeId: string;

  @Column()
  locationId: string;

  @Column('integer')
  balanceHundredths: number;

  @Column({ default: true })
  isValid: boolean;
}
