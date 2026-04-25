import { BadRequestException } from '@nestjs/common';

export function daysToHundredths(days: number): number {
  if (typeof days !== 'number' || Number.isNaN(days) || !Number.isFinite(days)) {
    throw new BadRequestException('days must be a finite number');
  }

  const rounded = Math.round(days * 100);
  if (Math.abs(days * 100 - rounded) > Number.EPSILON * 100) {
    throw new BadRequestException('days supports at most two decimal places');
  }

  if (rounded <= 0) {
    throw new BadRequestException('days must be greater than zero');
  }

  return rounded;
}

export function nonNegativeDaysToHundredths(days: number): number {
  if (typeof days !== 'number' || Number.isNaN(days) || !Number.isFinite(days)) {
    throw new BadRequestException('days must be a finite number');
  }

  const rounded = Math.round(days * 100);
  if (Math.abs(days * 100 - rounded) > Number.EPSILON * 100) {
    throw new BadRequestException('days supports at most two decimal places');
  }

  if (rounded < 0) {
    throw new BadRequestException('days must not be negative');
  }

  return rounded;
}

export function hundredthsToDays(hundredths: number): number {
  return Number((hundredths / 100).toFixed(2));
}

export function normalizePositiveHundredths(value: number, fieldName: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new BadRequestException(`${fieldName} must be a non-negative integer`);
  }
  return value;
}
