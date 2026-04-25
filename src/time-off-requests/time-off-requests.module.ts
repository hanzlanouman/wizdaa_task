import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { BalancesModule } from '../balances/balances.module';
import { Balance, TimeOffRequest } from '../database/entities';
import { HcmClientModule } from '../hcm/hcm-client.module';
import { TimeOffRequestsController } from './time-off-requests.controller';
import { TimeOffRequestsService } from './time-off-requests.service';

@Module({
  imports: [TypeOrmModule.forFeature([Balance, TimeOffRequest]), AuditModule, BalancesModule, HcmClientModule],
  controllers: [TimeOffRequestsController],
  providers: [TimeOffRequestsService],
})
export class TimeOffRequestsModule {}
