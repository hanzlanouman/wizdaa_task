import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class BatchBalanceDto {
  @IsString()
  @IsNotEmpty()
  employeeId: string;

  @IsString()
  @IsNotEmpty()
  locationId: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  balanceDays: number;

  @IsOptional()
  @IsString()
  externalVersion?: string;
}

export class BatchSyncDto {
  @IsString()
  @IsNotEmpty()
  batchId: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => BatchBalanceDto)
  balances: BatchBalanceDto[];
}
