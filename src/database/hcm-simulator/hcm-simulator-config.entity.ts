import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('hcm_simulator_config')
export class HcmSimulatorConfig {
  @PrimaryColumn()
  id: string;

  @Column({ default: false })
  isUnavailable: boolean;

  @Column({ default: false })
  forceApplySuccess: boolean;

  @Column('integer', { default: 0 })
  responseDelayMs: number;
}
