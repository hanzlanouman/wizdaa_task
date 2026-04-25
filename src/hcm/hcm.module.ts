import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HcmSimulatorAppliedRequest, HcmSimulatorBalance, HcmSimulatorConfig } from '../database/entities';
import { HcmService } from './hcm.service';
import { HcmSimulatorController } from './hcm-simulator.controller';

@Module({
  imports: [TypeOrmModule.forFeature([HcmSimulatorAppliedRequest, HcmSimulatorBalance, HcmSimulatorConfig])],
  controllers: [HcmSimulatorController],
  providers: [HcmService],
  exports: [HcmService],
})
export class HcmModule {}
