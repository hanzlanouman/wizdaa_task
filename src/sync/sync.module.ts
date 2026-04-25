import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Balance, BalanceSyncEvent } from '../database/entities';
import { SyncController } from './sync.controller';
import { SyncService } from './sync.service';

@Module({
  imports: [TypeOrmModule.forFeature([Balance, BalanceSyncEvent])],
  controllers: [SyncController],
  providers: [SyncService],
})
export class SyncModule {}
