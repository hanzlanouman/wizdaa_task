import {
  BadGatewayException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { DataSource, Repository } from 'typeorm';
import { hundredthsToDays, nonNegativeDaysToHundredths } from '../common/day-utils';
import { sha256 } from '../common/hash';
import { runSerializedWrite } from '../common/write-queue';
import { HcmSimulatorAppliedRequest, HcmSimulatorBalance, HcmSimulatorConfig } from '../database/entities';
import { HcmApplyResult, HcmBalanceResult } from './hcm.types';
import { HcmSimulatorBatchPushDto } from './dto/hcm-simulator-batch-push.dto';
import { HcmSimulatorBalanceDto } from './dto/hcm-simulator-balance.dto';
import { HcmSimulatorConfigDto } from './dto/hcm-simulator-config.dto';

@Injectable()
export class HcmService {
  private readonly configId = 'default';

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(HcmSimulatorBalance)
    private readonly balances: Repository<HcmSimulatorBalance>,
    @InjectRepository(HcmSimulatorConfig)
    private readonly configs: Repository<HcmSimulatorConfig>,
    @InjectRepository(HcmSimulatorAppliedRequest)
    private readonly appliedRequests: Repository<HcmSimulatorAppliedRequest>,
  ) {}

  async getBalance(employeeId: string, locationId: string): Promise<HcmBalanceResult> {
    await this.assertAvailable();
    const balance = await this.balances.findOneBy({ employeeId, locationId });

    if (!balance || !balance.isValid) {
      throw new NotFoundException('HCM does not have a valid balance for this employee/location');
    }

    return {
      employeeId,
      locationId,
      balanceHundredths: balance.balanceHundredths,
      externalVersion: `simulator-${balance.balanceHundredths}`,
    };
  }

  async applyTimeOff(input: {
    employeeId: string;
    locationId: string;
    daysHundredths: number;
    requestId: string;
  }): Promise<HcmApplyResult> {
    await this.assertAvailable();
    const payloadHash = sha256(input);

    return runSerializedWrite(() => this.dataSource.transaction(async (manager) => {
      const appliedRepository = manager.getRepository(HcmSimulatorAppliedRequest);
      const existing = await appliedRepository.findOneBy({ requestId: input.requestId });
      if (existing) {
        if (existing.payloadHash !== payloadHash) {
          throw new ConflictException('HCM requestId was reused with a different payload');
        }

        return {
          employeeId: input.employeeId,
          locationId: input.locationId,
          balanceHundredths: existing.resultingBalanceHundredths,
          hcmTransactionId: existing.hcmTransactionId,
          idempotent: true,
        };
      }

      const balanceRepository = manager.getRepository(HcmSimulatorBalance);
      const config = await this.getConfig(manager.getRepository(HcmSimulatorConfig));
      const balance = await balanceRepository.findOneBy({
        employeeId: input.employeeId,
        locationId: input.locationId,
      });

      if (!balance || !balance.isValid) {
        throw new NotFoundException('HCM rejected invalid employee/location dimensions');
      }

      if (balance.balanceHundredths < input.daysHundredths && !config.forceApplySuccess) {
        throw new ConflictException('HCM rejected time off because balance is insufficient');
      }

      balance.balanceHundredths -= input.daysHundredths;
      await balanceRepository.save(balance);

      const applied = appliedRepository.create({
        requestId: input.requestId,
        payloadHash,
        hcmTransactionId: `hcm-${randomUUID()}`,
        resultingBalanceHundredths: balance.balanceHundredths,
      });
      await appliedRepository.save(applied);

      return {
        employeeId: input.employeeId,
        locationId: input.locationId,
        balanceHundredths: balance.balanceHundredths,
        hcmTransactionId: applied.hcmTransactionId,
        idempotent: false,
      };
    }));
  }

  async upsertSimulatorBalance(
    employeeId: string,
    locationId: string,
    dto: HcmSimulatorBalanceDto,
  ): Promise<HcmBalanceResult & { isValid: boolean }> {
    const balanceHundredths = nonNegativeDaysToHundredths(dto.balanceDays);
    let balance = await this.balances.findOneBy({ employeeId, locationId });

    if (!balance) {
      balance = this.balances.create({ employeeId, locationId });
    }

    balance.balanceHundredths = balanceHundredths;
    balance.isValid = dto.isValid ?? true;
    await this.balances.save(balance);

    return {
      employeeId,
      locationId,
      balanceHundredths,
      isValid: balance.isValid,
      externalVersion: `simulator-${balanceHundredths}`,
    };
  }

  async updateConfig(dto: HcmSimulatorConfigDto): Promise<HcmSimulatorConfig> {
    const config = await this.getConfig();
    config.isUnavailable = dto.isUnavailable ?? config.isUnavailable;
    config.forceApplySuccess = dto.forceApplySuccess ?? config.forceApplySuccess;
    config.responseDelayMs = dto.responseDelayMs ?? config.responseDelayMs;
    return this.configs.save(config);
  }

  async reset(): Promise<{ ok: true }> {
    await this.appliedRequests.clear();
    await this.balances.clear();
    await this.configs.clear();
    await this.getConfig();
    return { ok: true };
  }

  async pushBatchToTimeOff(dto: HcmSimulatorBatchPushDto) {
    await this.assertAvailable();
    const timeOffBaseUrl = (process.env.TIMEOFF_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
    const balances = (await this.balances.find())
      .filter((balance) => balance.isValid)
      .sort((a, b) => `${a.employeeId}:${a.locationId}`.localeCompare(`${b.employeeId}:${b.locationId}`))
      .map((balance) => ({
        employeeId: balance.employeeId,
        locationId: balance.locationId,
        balanceDays: hundredthsToDays(balance.balanceHundredths),
        externalVersion: `simulator-${balance.balanceHundredths}`,
      }));

    if (balances.length === 0) {
      throw new ConflictException('HCM does not have any valid balances to push');
    }

    let response: Response;
    try {
      response = await fetch(`${timeOffBaseUrl}/sync/hcm/balances`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          batchId: dto.batchId ?? `hcm-batch-${randomUUID()}`,
          balances,
        }),
      });
    } catch {
      throw new ServiceUnavailableException('TimeOff service is unavailable');
    }

    const body = await this.readResponse(response);
    if (!response.ok) {
      if (response.status === 409) {
        throw new ConflictException(body.message ?? 'TimeOff rejected the HCM batch');
      }
      if (response.status === 503) {
        throw new ServiceUnavailableException(body.message ?? 'TimeOff service is unavailable');
      }
      throw new BadGatewayException(body.message ?? 'TimeOff rejected the HCM batch');
    }

    return body;
  }

  formatBalance(result: HcmBalanceResult & { isValid?: boolean }) {
    return {
      employeeId: result.employeeId,
      locationId: result.locationId,
      balanceDays: hundredthsToDays(result.balanceHundredths),
      externalVersion: result.externalVersion,
      ...(typeof result.isValid === 'boolean' ? { isValid: result.isValid } : {}),
    };
  }

  formatApply(result: HcmApplyResult) {
    return {
      employeeId: result.employeeId,
      locationId: result.locationId,
      balanceDays: hundredthsToDays(result.balanceHundredths),
      hcmTransactionId: result.hcmTransactionId,
      idempotent: result.idempotent,
    };
  }

  private async assertAvailable(): Promise<void> {
    const config = await this.getConfig();
    if (config.responseDelayMs > 0) {
      await this.sleep(config.responseDelayMs);
    }
    if (config.isUnavailable) {
      throw new ServiceUnavailableException('HCM is unavailable');
    }
  }

  private async getConfig(repository = this.configs): Promise<HcmSimulatorConfig> {
    let config = await repository.findOneBy({ id: this.configId });
    if (!config) {
      config = repository.create({
        id: this.configId,
        isUnavailable: false,
        forceApplySuccess: false,
        responseDelayMs: 0,
      });
      config = await repository.save(config);
    }
    return config;
  }

  private sleep(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  private async readResponse(response: Response): Promise<Record<string, string>> {
    const text = await response.text();
    if (!text) {
      return {};
    }

    try {
      return JSON.parse(text) as Record<string, string>;
    } catch {
      throw new BadGatewayException('TimeOff returned an invalid response');
    }
  }
}
