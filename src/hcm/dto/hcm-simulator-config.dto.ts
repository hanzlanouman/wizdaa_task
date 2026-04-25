import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';

export class HcmSimulatorConfigDto {
  @IsOptional()
  @IsBoolean()
  isUnavailable?: boolean;

  @IsOptional()
  @IsBoolean()
  forceApplySuccess?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(30_000)
  responseDelayMs?: number;
}
