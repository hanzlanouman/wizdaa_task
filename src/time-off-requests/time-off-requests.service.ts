import {
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { DataSource, Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { BalancesService } from '../balances/balances.service';
import { daysToHundredths, hundredthsToDays } from '../common/day-utils';
import { sha256 } from '../common/hash';
import { BalanceSource, TimeOffRequestStatus } from '../common/status.enum';
import { runSerializedWrite } from '../common/write-queue';
import { Balance, TimeOffRequest } from '../database/entities';
import { HcmClientService } from '../hcm/hcm-client.service';
import { CreateTimeOffRequestDto } from './dto/create-time-off-request.dto';

interface CreateAttemptResult {
  request?: TimeOffRequest;
  insufficient?: boolean;
}

interface RequestValidation {
  request: TimeOffRequest;
  availability: Awaited<ReturnType<BalancesService['refreshFromHcm']>>;
  canApprove: boolean;
  validationReason: string;
  validatedAt: Date;
}

@Injectable()
export class TimeOffRequestsService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(TimeOffRequest)
    private readonly requests: Repository<TimeOffRequest>,
    @InjectRepository(Balance)
    private readonly balances: Repository<Balance>,
    private readonly balancesService: BalancesService,
    private readonly hcm: HcmClientService,
    private readonly audit: AuditService,
  ) {}

  async create(dto: CreateTimeOffRequestDto, idempotencyKey?: string): Promise<TimeOffRequest> {
    const daysHundredths = daysToHundredths(dto.days);
    const payloadHash = this.createPayloadHash(dto, daysHundredths);

    if (idempotencyKey) {
      const existing = await this.requests.findOneBy({ idempotencyKey });
      if (existing) {
        if (existing.idempotencyPayloadHash !== payloadHash) {
          throw new ConflictException('Idempotency-Key was reused with a different payload');
        }
        return existing;
      }
    }

    await this.balancesService.refreshFromHcm(dto.employeeId, dto.locationId);

    let result = await this.tryCreate(dto, daysHundredths, idempotencyKey, payloadHash);
    if (result.request) {
      return result.request;
    }

    throw new ConflictException('Insufficient available balance for this request');
  }

  async findAll(filters: {
    employeeId?: string;
    locationId?: string;
    status?: TimeOffRequestStatus;
  }): Promise<TimeOffRequest[]> {
    return this.requests.find({
      where: {
        ...(filters.employeeId ? { employeeId: filters.employeeId } : {}),
        ...(filters.locationId ? { locationId: filters.locationId } : {}),
        ...(filters.status ? { status: filters.status } : {}),
      },
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string): Promise<TimeOffRequest> {
    const request = await this.requests.findOneBy({ id });
    if (!request) {
      throw new NotFoundException('Time-off request was not found');
    }
    return request;
  }

  async validate(id: string): Promise<RequestValidation> {
    const request = await this.findOne(id);
    const availability = await this.balancesService.refreshFromHcm(request.employeeId, request.locationId);
    const statusAllowsApproval = request.status === TimeOffRequestStatus.Pending;
    const hcmHasBalance = availability.balanceHundredths >= request.daysHundredths;

    let validationReason = 'HCM balance is sufficient for this request';
    if (!statusAllowsApproval) {
      validationReason = `Cannot approve a ${request.status} request`;
    } else if (!hcmHasBalance) {
      validationReason = 'HCM balance is insufficient for this request';
    }

    return {
      request,
      availability,
      canApprove: statusAllowsApproval && hcmHasBalance,
      validationReason,
      validatedAt: new Date(),
    };
  }

  async approve(id: string, managerId: string): Promise<TimeOffRequest> {
    const approvalAttemptId = randomUUID();
    const request = await this.markApproving(id, approvalAttemptId, managerId);
    if (request.status === TimeOffRequestStatus.Approved) {
      return request;
    }
    let applyResult: Awaited<ReturnType<HcmClientService['applyTimeOff']>> | undefined;
    let reverted = false;

    try {
      const hcmBalance = await this.hcm.getBalance(request.employeeId, request.locationId);
      if (hcmBalance.balanceHundredths < request.daysHundredths) {
        await this.revertApproving(
          request,
          approvalAttemptId,
          managerId,
          'APPROVAL_FAILED_INSUFFICIENT_HCM_BALANCE',
          'HCM balance was insufficient at approval time',
        );
        reverted = true;
        throw new ConflictException('HCM balance is insufficient for approval');
      }

      applyResult = await this.hcm.applyTimeOff({
        employeeId: request.employeeId,
        locationId: request.locationId,
        daysHundredths: request.daysHundredths,
        requestId: request.id,
      });
    } catch (error) {
      if (!reverted) {
        await this.revertApproving(
          request,
          approvalAttemptId,
          managerId,
          error instanceof ServiceUnavailableException
            ? 'APPROVAL_FAILED_HCM_UNAVAILABLE'
            : 'APPROVAL_FAILED_HCM_REJECTED',
          error instanceof ServiceUnavailableException
            ? 'HCM was unavailable during approval'
            : 'HCM rejected the approval attempt',
        );
      }
      throw error;
    }

    return runSerializedWrite(() => this.dataSource.transaction(async (manager) => {
      const requestRepository = manager.getRepository(TimeOffRequest);
      const balanceRepository = manager.getRepository(Balance);
      const approvingRequest = await requestRepository.findOneBy({
        id,
        status: TimeOffRequestStatus.Approving,
        approvalAttemptId,
      });
      if (!approvingRequest) {
        throw new ConflictException('Approval attempt is no longer active');
      }

      let balance = await balanceRepository.findOneBy({
        employeeId: request.employeeId,
        locationId: request.locationId,
      });
      if (!balance) {
        balance = balanceRepository.create({
          employeeId: request.employeeId,
          locationId: request.locationId,
        });
      }
      if (!applyResult) {
        throw new ConflictException('Approval result was not available');
      }
      balance.balanceHundredths = applyResult.balanceHundredths;
      balance.lastSyncedAt = new Date();
      balance.source = BalanceSource.HcmRealtime;
      balance.externalVersion = applyResult.externalVersion;
      await balanceRepository.save(balance);

      approvingRequest.status = TimeOffRequestStatus.Approved;
      approvingRequest.decidedBy = managerId;
      approvingRequest.decidedAt = new Date();
      approvingRequest.hcmTransactionId = applyResult.hcmTransactionId;
      approvingRequest.approvalAttemptId = undefined;
      approvingRequest.approvalStartedAt = undefined;
      const saved = await requestRepository.save(approvingRequest);

      await this.audit.record(
        {
          requestId: saved.id,
          eventType: 'REQUEST_APPROVED',
          actorId: managerId,
          metadata: { hcmTransactionId: applyResult.hcmTransactionId },
        },
        manager,
      );

      return saved;
    }));
  }

  async reject(id: string, managerId: string, reason?: string): Promise<TimeOffRequest> {
    return this.setTerminalStatus(id, TimeOffRequestStatus.Rejected, managerId, reason);
  }

  async cancel(id: string, actorId: string, reason?: string): Promise<TimeOffRequest> {
    return this.setTerminalStatus(id, TimeOffRequestStatus.Cancelled, actorId, reason);
  }

  formatRequest(request: TimeOffRequest) {
    return {
      id: request.id,
      employeeId: request.employeeId,
      locationId: request.locationId,
      days: hundredthsToDays(request.daysHundredths),
      startDate: request.startDate,
      endDate: request.endDate,
      reason: request.reason,
      status: request.status,
      requestedBy: request.requestedBy,
      decidedBy: request.decidedBy,
      decidedAt: request.decidedAt,
      hcmTransactionId: request.hcmTransactionId,
      createdAt: request.createdAt,
      updatedAt: request.updatedAt,
    };
  }

  formatValidation(validation: RequestValidation) {
    return {
      request: this.formatRequest(validation.request),
      employeeId: validation.request.employeeId,
      locationId: validation.request.locationId,
      status: validation.request.status,
      requestedDays: hundredthsToDays(validation.request.daysHundredths),
      hcmBalanceDays: hundredthsToDays(validation.availability.balanceHundredths),
      reservedDays: hundredthsToDays(validation.availability.reservedHundredths),
      availableDays: hundredthsToDays(validation.availability.availableHundredths),
      lastSyncedAt: validation.availability.lastSyncedAt,
      source: validation.availability.source,
      externalVersion: validation.availability.externalVersion,
      balanceAgeSeconds: validation.availability.balanceAgeSeconds,
      isFresh: validation.availability.isFresh,
      isStale: validation.availability.isStale,
      staleAfterSeconds: validation.availability.staleAfterSeconds,
      canApprove: validation.canApprove,
      validationReason: validation.validationReason,
      validatedAt: validation.validatedAt,
    };
  }

  private async tryCreate(
    dto: CreateTimeOffRequestDto,
    daysHundredths: number,
    idempotencyKey: string | undefined,
    payloadHash: string,
  ): Promise<CreateAttemptResult> {
    return runSerializedWrite(() => this.dataSource.transaction(async (manager) => {
      const balanceRepository = manager.getRepository(Balance);
      const requestRepository = manager.getRepository(TimeOffRequest);
      const balance = await balanceRepository.findOneBy({
        employeeId: dto.employeeId,
        locationId: dto.locationId,
      });
      if (!balance) {
        throw new NotFoundException('No local balance snapshot exists for this employee/location');
      }

      const availability = await this.balancesService.availabilityFromBalance(balance, manager);
      if (availability.availableHundredths < daysHundredths) {
        return { insufficient: true };
      }

      const request = requestRepository.create({
        employeeId: dto.employeeId,
        locationId: dto.locationId,
        daysHundredths,
        startDate: dto.startDate,
        endDate: dto.endDate,
        reason: dto.reason,
        requestedBy: dto.requestedBy,
        status: TimeOffRequestStatus.Pending,
        idempotencyKey,
        idempotencyPayloadHash: idempotencyKey ? payloadHash : undefined,
      });
      const saved = await requestRepository.save(request);
      await this.audit.record(
        {
          requestId: saved.id,
          eventType: 'REQUEST_CREATED',
          actorId: dto.requestedBy,
          metadata: { daysHundredths },
        },
        manager,
      );

      return { request: saved };
    }));
  }

  private async markApproving(
    id: string,
    approvalAttemptId: string,
    actorId: string,
  ): Promise<TimeOffRequest> {
    return runSerializedWrite(() => this.dataSource.transaction(async (manager) => {
      const requestRepository = manager.getRepository(TimeOffRequest);
      const request = await requestRepository.findOneBy({ id });
      if (!request) {
        throw new NotFoundException('Time-off request was not found');
      }

      if (request.status === TimeOffRequestStatus.Approved) {
        return request;
      }
      if (request.status === TimeOffRequestStatus.Approving) {
        throw new ConflictException('Approval is already in progress');
      }
      if (request.status !== TimeOffRequestStatus.Pending) {
        throw new ConflictException(`Cannot approve a ${request.status} request`);
      }

      const updateResult = await requestRepository.update(
        { id, status: TimeOffRequestStatus.Pending },
        {
          status: TimeOffRequestStatus.Approving,
          approvalAttemptId,
          approvalStartedAt: new Date(),
        },
      );
      if (!updateResult.affected) {
        throw new ConflictException('Approval state changed before it could be locked');
      }

      const approving = await requestRepository.findOneBy({ id });
      if (!approving) {
        throw new NotFoundException('Time-off request was not found');
      }
      await this.audit.record(
        {
          requestId: id,
          eventType: 'REQUEST_APPROVING',
          actorId,
          metadata: { approvalAttemptId },
        },
        manager,
      );
      return approving;
    }));
  }

  private async revertApproving(
    request: TimeOffRequest,
    approvalAttemptId: string,
    actorId: string,
    eventType: string,
    message: string,
  ): Promise<void> {
    await runSerializedWrite(() => this.dataSource.transaction(async (manager) => {
      const requestRepository = manager.getRepository(TimeOffRequest);
      const active = await requestRepository.findOneBy({
        id: request.id,
        status: TimeOffRequestStatus.Approving,
        approvalAttemptId,
      });
      if (!active) {
        return;
      }
      active.status = TimeOffRequestStatus.Pending;
      active.approvalAttemptId = undefined;
      active.approvalStartedAt = undefined;
      await requestRepository.save(active);
      await this.audit.record(
        {
          requestId: request.id,
          eventType,
          actorId,
          message,
          metadata: { approvalAttemptId },
        },
        manager,
      );
    }));
  }

  private async setTerminalStatus(
    id: string,
    status: TimeOffRequestStatus.Rejected | TimeOffRequestStatus.Cancelled,
    actorId: string,
    reason?: string,
  ): Promise<TimeOffRequest> {
    return runSerializedWrite(() => this.dataSource.transaction(async (manager) => {
      const requestRepository = manager.getRepository(TimeOffRequest);
      const request = await requestRepository.findOneBy({ id });
      if (!request) {
        throw new NotFoundException('Time-off request was not found');
      }
      if (request.status !== TimeOffRequestStatus.Pending) {
        throw new ConflictException(`Cannot move a ${request.status} request to ${status}`);
      }

      request.status = status;
      request.decidedBy = actorId;
      request.decidedAt = new Date();
      const saved = await requestRepository.save(request);
      await this.audit.record(
        {
          requestId: id,
          eventType: status === TimeOffRequestStatus.Rejected ? 'REQUEST_REJECTED' : 'REQUEST_CANCELLED',
          actorId,
          message: reason,
        },
        manager,
      );
      return saved;
    }));
  }

  private createPayloadHash(dto: CreateTimeOffRequestDto, daysHundredths: number): string {
    return sha256({
      employeeId: dto.employeeId,
      locationId: dto.locationId,
      daysHundredths,
      startDate: dto.startDate ?? null,
      endDate: dto.endDate ?? null,
      reason: dto.reason ?? null,
      requestedBy: dto.requestedBy,
    });
  }
}
