import { Body, Controller, Post } from '@nestjs/common';
import { BatchSyncDto } from './dto/batch-sync.dto';
import { SyncService } from './sync.service';

@Controller('sync')
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  @Post('hcm/balances')
  async syncBalances(@Body() dto: BatchSyncDto) {
    return this.sync.syncBalances(dto);
  }
}
