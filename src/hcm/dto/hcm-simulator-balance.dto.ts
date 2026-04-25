import { IsBoolean, IsNumber, IsOptional, Min } from 'class-validator';

export class HcmSimulatorBalanceDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  balanceDays: number;

  @IsOptional()
  @IsBoolean()
  isValid?: boolean;
}
