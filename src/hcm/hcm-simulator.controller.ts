import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { daysToHundredths } from '../common/day-utils';
import { HcmSimulatorApplyDto } from './dto/hcm-simulator-apply.dto';
import { HcmSimulatorBatchPushDto } from './dto/hcm-simulator-batch-push.dto';
import { HcmSimulatorBalanceDto } from './dto/hcm-simulator-balance.dto';
import { HcmSimulatorConfigDto } from './dto/hcm-simulator-config.dto';
import { HcmService } from './hcm.service';

@Controller('hcm-simulator')
export class HcmSimulatorController {
  constructor(private readonly hcm: HcmService) {}

  @Get('balances/:employeeId/:locationId')
  async getBalance(@Param('employeeId') employeeId: string, @Param('locationId') locationId: string) {
    return this.hcm.formatBalance(await this.hcm.getBalance(employeeId, locationId));
  }

  @Put('balances/:employeeId/:locationId')
  async putBalance(
    @Param('employeeId') employeeId: string,
    @Param('locationId') locationId: string,
    @Body() dto: HcmSimulatorBalanceDto,
  ) {
    return this.hcm.formatBalance(await this.hcm.upsertSimulatorBalance(employeeId, locationId, dto));
  }

  @Post('time-off')
  async applyTimeOff(@Body() dto: HcmSimulatorApplyDto) {
    const result = await this.hcm.applyTimeOff({
      employeeId: dto.employeeId,
      locationId: dto.locationId,
      daysHundredths: daysToHundredths(dto.days),
      requestId: dto.requestId,
    });
    return this.hcm.formatApply(result);
  }

  @Post('config')
  async updateConfig(@Body() dto: HcmSimulatorConfigDto) {
    return this.hcm.updateConfig(dto);
  }

  @Post('batch-push')
  async pushBatchToTimeOff(@Body() dto: HcmSimulatorBatchPushDto) {
    return this.hcm.pushBatchToTimeOff(dto);
  }

  @Post('reset')
  async reset() {
    return this.hcm.reset();
  }
}
