import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import { AuditModule } from './audit/audit.module';
import { BalancesModule } from './balances/balances.module';
import { timeOffEntities } from './database/entities';
import { HealthModule } from './health/health.module';
import { SyncModule } from './sync/sync.module';
import { TimeOffRequestsModule } from './time-off-requests/time-off-requests.module';

const isTest = process.env.NODE_ENV === 'test' || Boolean(process.env.JEST_WORKER_ID);
const databasePath = process.env.TIMEOFF_DB_PATH ?? process.env.DB_PATH ?? 'data/time-off.sqlite';
if (!isTest) {
  mkdirSync(dirname(databasePath), { recursive: true });
}

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'sqlite',
      database: isTest ? ':memory:' : databasePath,
      entities: timeOffEntities,
      synchronize: true,
      dropSchema: isTest,
    }),
    AuditModule,
    BalancesModule,
    SyncModule,
    TimeOffRequestsModule,
    HealthModule.register('examplehr-time-off-service'),
  ],
})
export class AppModule {}
