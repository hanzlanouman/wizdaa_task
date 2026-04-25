import { BadRequestException } from '@nestjs/common';
import {
  daysToHundredths,
  hundredthsToDays,
  nonNegativeDaysToHundredths,
  normalizePositiveHundredths,
} from '../src/common/day-utils';

describe('day-utils', () => {
  describe('daysToHundredths', () => {
    it('converts positive day values into integer hundredths', () => {
      expect(daysToHundredths(1)).toBe(100);
      expect(daysToHundredths(1.5)).toBe(150);
      expect(daysToHundredths(0.01)).toBe(1);
    });

    it('rejects non-finite, non-positive, and over-precise day values', () => {
      expect(() => daysToHundredths(Number.NaN)).toThrow(BadRequestException);
      expect(() => daysToHundredths(Number.POSITIVE_INFINITY)).toThrow(BadRequestException);
      expect(() => daysToHundredths(0)).toThrow(BadRequestException);
      expect(() => daysToHundredths(-1)).toThrow(BadRequestException);
      expect(() => daysToHundredths(1.234)).toThrow(BadRequestException);
    });
  });

  describe('nonNegativeDaysToHundredths', () => {
    it('allows zero and positive day values', () => {
      expect(nonNegativeDaysToHundredths(0)).toBe(0);
      expect(nonNegativeDaysToHundredths(2.25)).toBe(225);
    });

    it('rejects invalid, negative, and over-precise day values', () => {
      expect(() => nonNegativeDaysToHundredths(Number.NaN)).toThrow(BadRequestException);
      expect(() => nonNegativeDaysToHundredths(Number.NEGATIVE_INFINITY)).toThrow(BadRequestException);
      expect(() => nonNegativeDaysToHundredths(-0.01)).toThrow(BadRequestException);
      expect(() => nonNegativeDaysToHundredths(3.456)).toThrow(BadRequestException);
    });
  });

  it('formats hundredths back into day precision', () => {
    expect(hundredthsToDays(0)).toBe(0);
    expect(hundredthsToDays(150)).toBe(1.5);
    expect(hundredthsToDays(333)).toBe(3.33);
  });

  it('normalizes non-negative integer hundredths', () => {
    expect(normalizePositiveHundredths(0, 'balanceHundredths')).toBe(0);
    expect(normalizePositiveHundredths(125, 'balanceHundredths')).toBe(125);
    expect(() => normalizePositiveHundredths(1.5, 'balanceHundredths')).toThrow(BadRequestException);
    expect(() => normalizePositiveHundredths(-1, 'balanceHundredths')).toThrow(BadRequestException);
  });
});
