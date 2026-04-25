import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class ApproveTimeOffRequestDto {
  @IsString()
  @IsNotEmpty()
  managerId: string;
}

export class RejectTimeOffRequestDto {
  @IsString()
  @IsNotEmpty()
  managerId: string;

  @IsOptional()
  @IsString()
  reason?: string;
}

export class CancelTimeOffRequestDto {
  @IsString()
  @IsNotEmpty()
  actorId: string;

  @IsOptional()
  @IsString()
  reason?: string;
}
