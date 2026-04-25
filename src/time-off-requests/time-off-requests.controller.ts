import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { TimeOffRequestStatus } from '../common/status.enum';
import {
  ApproveTimeOffRequestDto,
  CancelTimeOffRequestDto,
  RejectTimeOffRequestDto,
} from './dto/decision.dto';
import { CreateTimeOffRequestDto } from './dto/create-time-off-request.dto';
import { TimeOffRequestsService } from './time-off-requests.service';

@Controller('time-off-requests')
export class TimeOffRequestsController {
  constructor(private readonly requests: TimeOffRequestsService) {}

  @Post()
  async create(
    @Body() dto: CreateTimeOffRequestDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.requests.formatRequest(await this.requests.create(dto, idempotencyKey));
  }

  @Get()
  async findAll(
    @Query('employeeId') employeeId?: string,
    @Query('locationId') locationId?: string,
    @Query('status') status?: TimeOffRequestStatus,
  ) {
    const requests = await this.requests.findAll({ employeeId, locationId, status });
    return requests.map((request) => this.requests.formatRequest(request));
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.requests.formatRequest(await this.requests.findOne(id));
  }

  @Post(':id/approve')
  async approve(@Param('id') id: string, @Body() dto: ApproveTimeOffRequestDto) {
    return this.requests.formatRequest(await this.requests.approve(id, dto.managerId));
  }

  @Post(':id/reject')
  async reject(@Param('id') id: string, @Body() dto: RejectTimeOffRequestDto) {
    return this.requests.formatRequest(await this.requests.reject(id, dto.managerId, dto.reason));
  }

  @Post(':id/cancel')
  async cancel(@Param('id') id: string, @Body() dto: CancelTimeOffRequestDto) {
    return this.requests.formatRequest(await this.requests.cancel(id, dto.actorId, dto.reason));
  }
}
