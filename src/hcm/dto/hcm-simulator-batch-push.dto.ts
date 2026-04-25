import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class HcmSimulatorBatchPushDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  batchId?: string;
}
