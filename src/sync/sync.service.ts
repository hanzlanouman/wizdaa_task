import { ConflictException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { nonNegativeDaysToHundredths } from '../common/day-utils';
import { sha256 } from '../common/hash';
import { BalanceSource, SyncStatus } from '../common/status.enum';
import { runSerializedWrite } from '../common/write-queue';
import { Balance, BalanceSyncEvent } from '../database/entities';
import { BatchSyncDto } from './dto/batch-sync.dto';

@Injectable()
export class SyncService {
  constructor(
    private readonly dataSource: DataSource,
  ) {}

  async syncBalances(dto: BatchSyncDto) {
    const normalized = dto.balances
      .map((balance) => ({
        employeeId: balance.employeeId,
        locationId: balance.locationId,
        balanceHundredths: nonNegativeDaysToHundredths(balance.balanceDays),
        externalVersion: balance.externalVersion ?? null,
      }))
      .sort((a, b) =>
        `${a.employeeId}:${a.locationId}`.localeCompare(`${b.employeeId}:${b.locationId}`),
      );
    const payloadHash = sha256({ batchId: dto.batchId, balances: normalized });

    return runSerializedWrite(() =>
      this.dataSource.transaction(async (manager) => {
        const syncEventRepository = manager.getRepository(BalanceSyncEvent);
        const balanceRepository = manager.getRepository(Balance);
        const existing = await syncEventRepository.findOneBy({ batchId: dto.batchId });
        if (existing) {
          if (existing.payloadHash !== payloadHash) {
            throw new ConflictException('batchId was replayed with a different payload');
          }

          return {
            batchId: existing.batchId,
            status: existing.status,
            recordsReceived: existing.recordsReceived,
            recordsUpserted: existing.recordsUpserted,
            idempotent: true,
          };
        }

        const now = new Date();
        let upserted = 0;
        for (const record of normalized) {
          let balance = await balanceRepository.findOneBy({
            employeeId: record.employeeId,
            locationId: record.locationId,
          });
          if (!balance) {
            balance = balanceRepository.create({
              employeeId: record.employeeId,
              locationId: record.locationId,
            });
          }
          balance.balanceHundredths = record.balanceHundredths;
          balance.externalVersion = record.externalVersion ?? undefined;
          balance.lastSyncedAt = now;
          balance.source = BalanceSource.HcmBatch;
          await balanceRepository.save(balance);
          upserted += 1;
        }

        const event = syncEventRepository.create({
          batchId: dto.batchId,
          payloadHash,
          recordsReceived: normalized.length,
          recordsUpserted: upserted,
          status: SyncStatus.Success,
        });
        await syncEventRepository.save(event);

        return {
          batchId: dto.batchId,
          status: event.status,
          recordsReceived: event.recordsReceived,
          recordsUpserted: event.recordsUpserted,
          idempotent: false,
        };
      }),
    );
  }
}
