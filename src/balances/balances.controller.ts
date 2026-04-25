import { Controller, Get, Param, Post } from '@nestjs/common';
import { BalancesService } from './balances.service';

@Controller('balances')
export class BalancesController {
  constructor(private readonly balances: BalancesService) {}

  @Get(':employeeId/:locationId')
  async getBalance(@Param('employeeId') employeeId: string, @Param('locationId') locationId: string) {
    return this.balances.formatAvailability(
      await this.balances.getAvailability(employeeId, locationId),
    );
  }

  @Post(':employeeId/:locationId/refresh')
  async refresh(@Param('employeeId') employeeId: string, @Param('locationId') locationId: string) {
    return this.balances.formatAvailability(await this.balances.refreshFromHcm(employeeId, locationId));
  }
}
