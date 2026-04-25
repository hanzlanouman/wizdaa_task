import {
  BadGatewayException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { hundredthsToDays, nonNegativeDaysToHundredths } from '../common/day-utils';
import { HcmApplyResult, HcmBalanceResult } from './hcm.types';

interface HcmBalanceResponse {
  employeeId: string;
  locationId: string;
  balanceDays: number;
  externalVersion?: string;
}

interface HcmApplyResponse extends HcmBalanceResponse {
  hcmTransactionId: string;
  idempotent: boolean;
}

@Injectable()
export class HcmClientService {
  async getBalance(employeeId: string, locationId: string): Promise<HcmBalanceResult> {
    const response = await this.request<HcmBalanceResponse>(
      `/hcm-simulator/balances/${encodeURIComponent(employeeId)}/${encodeURIComponent(locationId)}`,
      { method: 'GET' },
    );

    return {
      employeeId: response.employeeId,
      locationId: response.locationId,
      balanceHundredths: nonNegativeDaysToHundredths(response.balanceDays),
      externalVersion: response.externalVersion,
    };
  }

  async applyTimeOff(input: {
    employeeId: string;
    locationId: string;
    daysHundredths: number;
    requestId: string;
  }): Promise<HcmApplyResult> {
    const response = await this.request<HcmApplyResponse>('/hcm-simulator/time-off', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        employeeId: input.employeeId,
        locationId: input.locationId,
        days: hundredthsToDays(input.daysHundredths),
        requestId: input.requestId,
      }),
    });

    return {
      employeeId: response.employeeId,
      locationId: response.locationId,
      balanceHundredths: nonNegativeDaysToHundredths(response.balanceDays),
      externalVersion: response.externalVersion,
      hcmTransactionId: response.hcmTransactionId,
      idempotent: response.idempotent,
    };
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs());
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl()}${path}`, {
        ...init,
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new ServiceUnavailableException('HCM request timed out');
      }
      throw new ServiceUnavailableException('HCM is unavailable');
    } finally {
      clearTimeout(timeout);
    }

    const body = await this.readBody(response);
    if (!response.ok) {
      this.throwMappedError(response.status, body);
    }

    return body as T;
  }

  private async readBody(response: Response): Promise<Record<string, unknown>> {
    const text = await response.text();
    if (!text) {
      return {};
    }

    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new BadGatewayException('HCM returned an invalid response');
    }
  }

  private throwMappedError(status: number, body: Record<string, unknown>): never {
    const message = typeof body.message === 'string' ? body.message : 'HCM request failed';
    if (status === 404) {
      throw new NotFoundException(message);
    }
    if (status === 409) {
      throw new ConflictException(message);
    }
    if (status === 503) {
      throw new ServiceUnavailableException(message);
    }

    throw new BadGatewayException(message);
  }

  private baseUrl(): string {
    return (process.env.HCM_BASE_URL ?? 'http://localhost:3001').replace(/\/$/, '');
  }

  private timeoutMs(): number {
    const parsed = Number(process.env.HCM_TIMEOUT_MS ?? 2_000);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 2_000;
  }
}
