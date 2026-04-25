import { IsNotEmpty, IsNumber, IsString, Min } from 'class-validator';

export class HcmSimulatorApplyDto {
  @IsString()
  @IsNotEmpty()
  employeeId: string;

  @IsString()
  @IsNotEmpty()
  locationId: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  days: number;

  @IsString()
  @IsNotEmpty()
  requestId: string;
}
