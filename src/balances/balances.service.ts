import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import { BalanceSource, TimeOffRequestStatus } from '../common/status.enum';
import { hundredthsToDays } from '../common/day-utils';
import { Balance, TimeOffRequest } from '../database/entities';
import { HcmClientService } from '../hcm/hcm-client.service';
import { HcmBalanceResult } from '../hcm/hcm.types';

export interface Availability {
  employeeId: string;
  locationId: string;
  balanceHundredths: number;
  reservedHundredths: number;
  availableHundredths: number;
  lastSyncedAt: Date;
  source: BalanceSource;
  externalVersion?: string;
}

@Injectable()
export class BalancesService {
  constructor(
    @InjectRepository(Balance)
    private readonly balances: Repository<Balance>,
    @InjectRepository(TimeOffRequest)
    private readonly requests: Repository<TimeOffRequest>,
    private readonly hcm: HcmClientService,
  ) {}

  async getAvailability(employeeId: string, locationId: string): Promise<Availability> {
    const balance = await this.balances.findOneBy({ employeeId, locationId });
    if (!balance) {
      throw new NotFoundException('No local balance snapshot exists for this employee/location');
    }
    return this.availabilityFromBalance(balance);
  }

  async getBalanceEntity(employeeId: string, locationId: string): Promise<Balance | null> {
    return this.balances.findOneBy({ employeeId, locationId });
  }

  async refreshFromHcm(employeeId: string, locationId: string): Promise<Availability> {
    const hcmBalance = await this.hcm.getBalance(employeeId, locationId);
    const balance = await this.upsertFromHcm(hcmBalance, BalanceSource.HcmRealtime);
    return this.availabilityFromBalance(balance);
  }

  async upsertFromHcm(
    hcmBalance: HcmBalanceResult,
    source: BalanceSource,
    manager?: EntityManager,
  ): Promise<Balance> {
    const repository = manager?.getRepository(Balance) ?? this.balances;
    let balance = await repository.findOneBy({
      employeeId: hcmBalance.employeeId,
      locationId: hcmBalance.locationId,
    });

    if (!balance) {
      balance = repository.create({
        employeeId: hcmBalance.employeeId,
        locationId: hcmBalance.locationId,
      });
    }

    balance.balanceHundredths = hcmBalance.balanceHundredths;
    balance.lastSyncedAt = new Date();
    balance.source = source;
    balance.externalVersion = hcmBalance.externalVersion;
    return repository.save(balance);
  }

  async availabilityFromBalance(balance: Balance, manager?: EntityManager): Promise<Availability> {
    const repository = manager?.getRepository(TimeOffRequest) ?? this.requests;
    const raw = await repository
      .createQueryBuilder('request')
      .select('COALESCE(SUM(request.daysHundredths), 0)', 'reserved')
      .where('request.employeeId = :employeeId', { employeeId: balance.employeeId })
      .andWhere('request.locationId = :locationId', { locationId: balance.locationId })
      .andWhere('request.status IN (:...statuses)', {
        statuses: [TimeOffRequestStatus.Pending, TimeOffRequestStatus.Approving],
      })
      .getRawOne<{ reserved: number | string }>();

    const reservedHundredths = Number(raw?.reserved ?? 0);
    return {
      employeeId: balance.employeeId,
      locationId: balance.locationId,
      balanceHundredths: balance.balanceHundredths,
      reservedHundredths,
      availableHundredths: balance.balanceHundredths - reservedHundredths,
      lastSyncedAt: balance.lastSyncedAt,
      source: balance.source,
      externalVersion: balance.externalVersion,
    };
  }

  formatAvailability(availability: Availability) {
    return {
      employeeId: availability.employeeId,
      locationId: availability.locationId,
      balanceDays: hundredthsToDays(availability.balanceHundredths),
      reservedDays: hundredthsToDays(availability.reservedHundredths),
      availableDays: hundredthsToDays(availability.availableHundredths),
      lastSyncedAt: availability.lastSyncedAt,
      source: availability.source,
      externalVersion: availability.externalVersion,
    };
  }

  reservingStatuses() {
    return In([TimeOffRequestStatus.Pending, TimeOffRequestStatus.Approving]);
  }
}
