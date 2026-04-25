import { Controller, Get, Inject } from '@nestjs/common';
import { HEALTH_SERVICE_NAME } from './health.constants';

@Controller('health')
export class HealthController {
  constructor(@Inject(HEALTH_SERVICE_NAME) private readonly serviceName: string) {}

  @Get()
  health() {
    return { status: 'ok', service: this.serviceName };
  }
}
