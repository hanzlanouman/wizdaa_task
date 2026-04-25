import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import { hcmSimulatorEntities } from './database/entities';
import { HcmModule } from './hcm/hcm.module';
import { HealthModule } from './health/health.module';

const isTest = process.env.NODE_ENV === 'test' || Boolean(process.env.JEST_WORKER_ID);
const databasePath = process.env.HCM_DB_PATH ?? 'data/hcm-simulator.sqlite';
if (!isTest) {
  mkdirSync(dirname(databasePath), { recursive: true });
}

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'sqlite',
      database: isTest ? ':memory:' : databasePath,
      entities: hcmSimulatorEntities,
      synchronize: true,
      dropSchema: isTest,
    }),
    HcmModule,
    HealthModule.register('hcm-simulator-service'),
  ],
})
export class HcmSimulatorAppModule {}
