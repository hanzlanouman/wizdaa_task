import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RequestEvent } from '../database/entities';
import { AuditService } from './audit.service';

@Module({
  imports: [TypeOrmModule.forFeature([RequestEvent])],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
