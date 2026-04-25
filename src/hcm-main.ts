import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { HcmSimulatorAppModule } from './hcm-simulator-app.module';

async function bootstrap() {
  const app = await NestFactory.create(HcmSimulatorAppModule);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  await app.listen(process.env.HCM_PORT ?? 3001);
}

void bootstrap();
