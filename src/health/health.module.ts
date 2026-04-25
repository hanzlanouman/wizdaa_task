import { DynamicModule, Module } from '@nestjs/common';
import { HEALTH_SERVICE_NAME } from './health.constants';
import { HealthController } from './health.controller';

@Module({})
export class HealthModule {
  static register(serviceName: string): DynamicModule {
    return {
      module: HealthModule,
      controllers: [HealthController],
      providers: [{ provide: HEALTH_SERVICE_NAME, useValue: serviceName }],
    };
  }
}
