import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { RequestEvent } from '../database/entities';

interface RequestEventInput {
  requestId?: string;
  eventType: string;
  actorId?: string;
  message?: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(RequestEvent)
    private readonly events: Repository<RequestEvent>,
  ) {}

  async record(input: RequestEventInput, manager?: EntityManager): Promise<RequestEvent> {
    const repository = manager?.getRepository(RequestEvent) ?? this.events;
    const event = repository.create({
      requestId: input.requestId,
      eventType: input.eventType,
      actorId: input.actorId,
      message: input.message,
      metadataJson: input.metadata ? JSON.stringify(input.metadata) : undefined,
    });
    return repository.save(event);
  }
}
