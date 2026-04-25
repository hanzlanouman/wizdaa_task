import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AddressInfo } from 'net';
import request from 'supertest';
import { DataSource, Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { HcmSimulatorAppModule } from '../src/hcm-simulator-app.module';
import { TimeOffRequestStatus } from '../src/common/status.enum';
import {
  BalanceSyncEvent,
  HcmSimulatorAppliedRequest,
  RequestEvent,
  TimeOffRequest,
} from '../src/database/entities';

describe('ExampleHR Time-Off Microservice', () => {
  let timeOffApp: INestApplication;
  let hcmApp: INestApplication;
  let timeOffDataSource: DataSource;
  let hcmDataSource: DataSource;
  let requestEvents: Repository<RequestEvent>;
  let syncEvents: Repository<BalanceSyncEvent>;
  let requestsRepository: Repository<TimeOffRequest>;
  let hcmAppliedRequests: Repository<HcmSimulatorAppliedRequest>;
  let timeOffServer: any;
  let hcmServer: any;
  let timeOffBaseUrl: string;
  let hcmBaseUrl: string;

  beforeAll(async () => {
    hcmApp = await createApp(HcmSimulatorAppModule);
    await hcmApp.listen(0);
    hcmServer = hcmApp.getHttpServer();
    hcmBaseUrl = serverBaseUrl(hcmServer);
    process.env.HCM_BASE_URL = hcmBaseUrl;

    timeOffApp = await createApp(AppModule);
    await timeOffApp.listen(0);
    timeOffServer = timeOffApp.getHttpServer();
    timeOffBaseUrl = serverBaseUrl(timeOffServer);
    process.env.TIMEOFF_BASE_URL = timeOffBaseUrl;

    timeOffDataSource = timeOffApp.get(DataSource);
    hcmDataSource = hcmApp.get(DataSource);
    requestEvents = timeOffDataSource.getRepository(RequestEvent);
    syncEvents = timeOffDataSource.getRepository(BalanceSyncEvent);
    requestsRepository = timeOffDataSource.getRepository(TimeOffRequest);
    hcmAppliedRequests = hcmDataSource.getRepository(HcmSimulatorAppliedRequest);
  });

  beforeEach(async () => {
    process.env.HCM_BASE_URL = hcmBaseUrl;
    process.env.TIMEOFF_BASE_URL = timeOffBaseUrl;
    delete process.env.HCM_TIMEOUT_MS;
    await timeOffDataSource.synchronize(true);
    await hcmDataSource.synchronize(true);
  });

  afterAll(async () => {
    await timeOffApp?.close();
    await hcmApp?.close();
  });

  async function createApp(module: typeof AppModule | typeof HcmSimulatorAppModule): Promise<INestApplication> {
    const moduleRef = await Test.createTestingModule({ imports: [module] }).compile();
    const app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
    return app;
  }

  function serverBaseUrl(server: any): string {
    const address = server.address() as AddressInfo;
    return `http://127.0.0.1:${address.port}`;
  }

  async function seedHcm(employeeId = 'emp-1', locationId = 'loc-1', balanceDays = 10, isValid = true) {
    return request(hcmServer)
      .put(`/hcm-simulator/balances/${employeeId}/${locationId}`)
      .send({ balanceDays, isValid })
      .expect(200);
  }

  async function syncBalance(batchId = 'batch-1', balanceDays = 10) {
    return syncBalances(batchId, [{ employeeId: 'emp-1', locationId: 'loc-1', balanceDays }]);
  }

  async function syncBalances(
    batchId: string,
    balances: Array<{ employeeId: string; locationId: string; balanceDays: number; externalVersion?: string }>,
  ) {
    return request(timeOffServer).post('/sync/hcm/balances').send({ batchId, balances }).expect(201);
  }

  function createRequest(days = 2, extra: Record<string, unknown> = {}) {
    return request(timeOffServer)
      .post('/time-off-requests')
      .send({
        employeeId: 'emp-1',
        locationId: 'loc-1',
        days,
        requestedBy: 'emp-1',
        ...extra,
      });
  }

  it('returns health status for both services', async () => {
    const timeOff = await request(timeOffServer).get('/health').expect(200);
    const hcm = await request(hcmServer).get('/health').expect(200);

    expect(timeOff.body).toEqual({ status: 'ok', service: 'examplehr-time-off-service' });
    expect(hcm.body).toEqual({ status: 'ok', service: 'hcm-simulator-service' });
  });

  it('keeps TimeOff and HCM simulator endpoints and tables separated', async () => {
    await request(timeOffServer).get('/hcm-simulator/balances/emp-1/loc-1').expect(404);

    const timeOffTables = await tableNames(timeOffDataSource);
    const hcmTables = await tableNames(hcmDataSource);

    expect(timeOffTables).toEqual(expect.arrayContaining(['balances', 'time_off_requests', 'request_events']));
    expect(timeOffTables).not.toEqual(expect.arrayContaining([
      'hcm_simulator_balances',
      'hcm_simulator_applied_requests',
      'hcm_simulator_config',
    ]));
    expect(hcmTables).toEqual(expect.arrayContaining(['hcm_simulator_balances', 'hcm_simulator_applied_requests']));
    expect(hcmTables).not.toEqual(expect.arrayContaining(['balances', 'time_off_requests', 'request_events']));
  });

  it('batch sync creates and updates balances', async () => {
    await syncBalance('batch-create', 10);

    let balance = await request(timeOffServer).get('/balances/emp-1/loc-1').expect(200);
    expect(balance.body.balanceDays).toBe(10);

    await syncBalance('batch-update', 12.5);
    balance = await request(timeOffServer).get('/balances/emp-1/loc-1').expect(200);
    expect(balance.body.balanceDays).toBe(12.5);
  });

  it('batch sync is idempotent by batchId and payload hash', async () => {
    const first = await syncBalance('batch-idempotent', 10);
    expect(first.body.idempotent).toBe(false);

    const second = await syncBalance('batch-idempotent', 10);
    expect(second.body.idempotent).toBe(true);

    await request(timeOffServer)
      .post('/sync/hcm/balances')
      .send({
        batchId: 'batch-idempotent',
        balances: [{ employeeId: 'emp-1', locationId: 'loc-1', balanceDays: 11 }],
      })
      .expect(409);

    expect(await syncEvents.count()).toBe(1);
  });

  it('rejects empty batch sync payloads', async () => {
    await request(timeOffServer)
      .post('/sync/hcm/balances')
      .send({ batchId: 'batch-empty', balances: [] })
      .expect(400);
  });

  it('HCM simulator can push a batch corpus into TimeOff', async () => {
    await seedHcm('emp-1', 'loc-1', 14);

    const pushed = await request(hcmServer)
      .post('/hcm-simulator/batch-push')
      .send({ batchId: 'hcm-push-1' })
      .expect(201);
    expect(pushed.body.recordsUpserted).toBe(1);

    const balance = await request(timeOffServer).get('/balances/emp-1/loc-1').expect(200);
    expect(balance.body.balanceDays).toBe(14);
  });

  it('returns cached, reserved, and available balance values', async () => {
    await syncBalance('batch-availability', 10);
    await createRequest(3).expect(201);

    const balance = await request(timeOffServer).get('/balances/emp-1/loc-1').expect(200);
    expect(balance.body.balanceDays).toBe(10);
    expect(balance.body.reservedDays).toBe(3);
    expect(balance.body.availableDays).toBe(7);
  });

  it('creates request with sufficient local availability and rejects insufficient availability', async () => {
    await syncBalance('batch-create-ok', 5);
    await seedHcm('emp-1', 'loc-1', 5);
    const created = await createRequest(4).expect(201);
    expect(created.body.status).toBe(TimeOffRequestStatus.Pending);

    await createRequest(2).expect(409);
  });

  it('fetches HCM when local cache is missing', async () => {
    await seedHcm('emp-1', 'loc-1', 8);

    const created = await createRequest(2).expect(201);
    expect(created.body.status).toBe(TimeOffRequestStatus.Pending);

    const balance = await request(timeOffServer).get('/balances/emp-1/loc-1').expect(200);
    expect(balance.body.balanceDays).toBe(8);
    expect(balance.body.availableDays).toBe(6);
  });

  it('refreshes HCM before rejecting insufficient local availability', async () => {
    await syncBalance('batch-low-local', 1);
    await seedHcm('emp-1', 'loc-1', 5);

    const created = await createRequest(3).expect(201);
    expect(created.body.status).toBe(TimeOffRequestStatus.Pending);

    const balance = await request(timeOffServer).get('/balances/emp-1/loc-1').expect(200);
    expect(balance.body.balanceDays).toBe(5);
    expect(balance.body.availableDays).toBe(2);
  });

  it('returns 503 when required HCM refresh is unavailable', async () => {
    await request(hcmServer).post('/hcm-simulator/config').send({ isUnavailable: true }).expect(201);

    await createRequest(1).expect(503);
  });

  it('returns 503 when HCM network is unreachable', async () => {
    process.env.HCM_BASE_URL = 'http://127.0.0.1:1';

    await createRequest(1).expect(503);
  });

  it('returns 503 when HCM realtime API times out', async () => {
    process.env.HCM_TIMEOUT_MS = '10';
    await seedHcm('emp-1', 'loc-1', 8);
    await request(hcmServer).post('/hcm-simulator/config').send({ responseDelayMs: 50 }).expect(201);

    await createRequest(1).expect(503);
    expect(await requestsRepository.count()).toBe(0);
  });

  it('counts APPROVING requests as reservations', async () => {
    await syncBalance('batch-approving-reserves', 5);
    const created = await createRequest(2).expect(201);
    await requestsRepository.update(created.body.id, { status: TimeOffRequestStatus.Approving });

    const balance = await request(timeOffServer).get('/balances/emp-1/loc-1').expect(200);
    expect(balance.body.reservedDays).toBe(2);
    expect(balance.body.availableDays).toBe(3);
  });

  it('prevents two requests from overspending the same employee/location balance', async () => {
    await syncBalance('batch-no-overspend', 5);
    await seedHcm('emp-1', 'loc-1', 5);

    const [first, second] = await Promise.all([createRequest(3), createRequest(3)]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([201, 409]);

    const balance = await request(timeOffServer).get('/balances/emp-1/loc-1').expect(200);
    expect(balance.body.reservedDays).toBe(3);
    expect(balance.body.availableDays).toBe(2);
  });

  it('isolates balances and reservations by employeeId and locationId', async () => {
    await syncBalances('batch-scope', [
      { employeeId: 'emp-1', locationId: 'loc-1', balanceDays: 5 },
      { employeeId: 'emp-1', locationId: 'loc-2', balanceDays: 7 },
      { employeeId: 'emp-2', locationId: 'loc-1', balanceDays: 9 },
    ]);

    await createRequest(3).expect(201);

    const sameEmployeeDifferentLocation = await request(timeOffServer).get('/balances/emp-1/loc-2').expect(200);
    expect(sameEmployeeDifferentLocation.body.reservedDays).toBe(0);
    expect(sameEmployeeDifferentLocation.body.availableDays).toBe(7);

    const differentEmployeeSameLocation = await request(timeOffServer).get('/balances/emp-2/loc-1').expect(200);
    expect(differentEmployeeSameLocation.body.reservedDays).toBe(0);
    expect(differentEmployeeSameLocation.body.availableDays).toBe(9);
  });

  it('validates invalid days and invalid HCM dimensions', async () => {
    await syncBalance('batch-validation', 5);
    await createRequest(0).expect(400);
    await createRequest(1.234).expect(400);

    await seedHcm('emp-bad', 'loc-bad', 5, false);
    await request(timeOffServer).post('/balances/emp-bad/loc-bad/refresh').send().expect(404);
  });

  it('handles create idempotency key safely', async () => {
    await syncBalance('batch-create-idempotency', 10);

    const first = await request(timeOffServer)
      .post('/time-off-requests')
      .set('Idempotency-Key', 'create-key-1')
      .send({ employeeId: 'emp-1', locationId: 'loc-1', days: 2, requestedBy: 'emp-1' })
      .expect(201);

    const second = await request(timeOffServer)
      .post('/time-off-requests')
      .set('Idempotency-Key', 'create-key-1')
      .send({ employeeId: 'emp-1', locationId: 'loc-1', days: 2, requestedBy: 'emp-1' })
      .expect(201);

    expect(second.body.id).toBe(first.body.id);

    await request(timeOffServer)
      .post('/time-off-requests')
      .set('Idempotency-Key', 'create-key-1')
      .send({ employeeId: 'emp-1', locationId: 'loc-1', days: 3, requestedBy: 'emp-1' })
      .expect(409);
  });

  it('lists and filters requests', async () => {
    await syncBalances('batch-list', [
      { employeeId: 'emp-1', locationId: 'loc-1', balanceDays: 10 },
      { employeeId: 'emp-1', locationId: 'loc-2', balanceDays: 10 },
    ]);
    const first = await createRequest(2).expect(201);
    await createRequest(2, { locationId: 'loc-2' }).expect(201);

    const filtered = await request(timeOffServer)
      .get('/time-off-requests')
      .query({ employeeId: 'emp-1', locationId: 'loc-1', status: TimeOffRequestStatus.Pending })
      .expect(200);

    expect(filtered.body).toHaveLength(1);
    expect(filtered.body[0].id).toBe(first.body.id);
  });

  it('returns 404 for a missing request id', async () => {
    await request(timeOffServer).get('/time-off-requests/missing-request-id').expect(404);
  });

  it('approves request after HCM validation and updates local cache', async () => {
    await seedHcm('emp-1', 'loc-1', 10);
    const created = await createRequest(2).expect(201);

    const approved = await request(timeOffServer)
      .post(`/time-off-requests/${created.body.id}/approve`)
      .send({ managerId: 'manager-1' })
      .expect(201);

    expect(approved.body.status).toBe(TimeOffRequestStatus.Approved);
    expect(approved.body.hcmTransactionId).toContain('hcm-');

    const balance = await request(timeOffServer).get('/balances/emp-1/loc-1').expect(200);
    expect(balance.body.balanceDays).toBe(8);
    expect(balance.body.reservedDays).toBe(0);
  });

  it('fails approval safely when HCM balance decreased externally', async () => {
    await seedHcm('emp-1', 'loc-1', 10);
    const created = await createRequest(6).expect(201);
    await seedHcm('emp-1', 'loc-1', 3);

    await request(timeOffServer)
      .post(`/time-off-requests/${created.body.id}/approve`)
      .send({ managerId: 'manager-1' })
      .expect(409);

    const requestRecord = await request(timeOffServer).get(`/time-off-requests/${created.body.id}`).expect(200);
    expect(requestRecord.body.status).toBe(TimeOffRequestStatus.Pending);
  });

  it('fails approval before apply when HCM apply behavior is unreliable', async () => {
    await seedHcm('emp-1', 'loc-1', 10);
    const created = await createRequest(6).expect(201);
    await seedHcm('emp-1', 'loc-1', 3);
    await request(hcmServer).post('/hcm-simulator/config').send({ forceApplySuccess: true }).expect(201);

    await request(timeOffServer)
      .post(`/time-off-requests/${created.body.id}/approve`)
      .send({ managerId: 'manager-1' })
      .expect(409);

    expect(await hcmAppliedRequests.count()).toBe(0);
  });

  it('fails approval safely when HCM is unavailable', async () => {
    await seedHcm('emp-1', 'loc-1', 10);
    const created = await createRequest(2).expect(201);
    await request(hcmServer).post('/hcm-simulator/config').send({ isUnavailable: true }).expect(201);

    await request(timeOffServer)
      .post(`/time-off-requests/${created.body.id}/approve`)
      .send({ managerId: 'manager-1' })
      .expect(503);

    const requestRecord = await request(timeOffServer).get(`/time-off-requests/${created.body.id}`).expect(200);
    expect(requestRecord.body.status).toBe(TimeOffRequestStatus.Pending);
  });

  it('fails approval safely when HCM times out during approval', async () => {
    await seedHcm('emp-1', 'loc-1', 10);
    const created = await createRequest(2).expect(201);
    process.env.HCM_TIMEOUT_MS = '10';
    await request(hcmServer).post('/hcm-simulator/config').send({ responseDelayMs: 50 }).expect(201);

    await request(timeOffServer)
      .post(`/time-off-requests/${created.body.id}/approve`)
      .send({ managerId: 'manager-1' })
      .expect(503);

    const requestRecord = await request(timeOffServer).get(`/time-off-requests/${created.body.id}`).expect(200);
    expect(requestRecord.body.status).toBe(TimeOffRequestStatus.Pending);
  });

  it('prevents double approval from double-deducting HCM', async () => {
    await seedHcm('emp-1', 'loc-1', 10);
    const created = await createRequest(2).expect(201);

    const [first, second] = await Promise.all([
      request(timeOffServer).post(`/time-off-requests/${created.body.id}/approve`).send({ managerId: 'manager-1' }),
      request(timeOffServer).post(`/time-off-requests/${created.body.id}/approve`).send({ managerId: 'manager-1' }),
    ]);

    expect([201, 409]).toContain(first.status);
    expect([201, 409]).toContain(second.status);
    expect(await hcmAppliedRequests.count()).toBe(1);

    const hcmBalance = await request(hcmServer).get('/hcm-simulator/balances/emp-1/loc-1').expect(200);
    expect(hcmBalance.body.balanceDays).toBe(8);
  });

  it('HCM apply replay with same requestId does not deduct twice', async () => {
    await seedHcm('emp-1', 'loc-1', 10);

    const first = await request(hcmServer)
      .post('/hcm-simulator/time-off')
      .send({ employeeId: 'emp-1', locationId: 'loc-1', days: 2, requestId: 'req-1' })
      .expect(201);
    expect(first.body.idempotent).toBe(false);

    const second = await request(hcmServer)
      .post('/hcm-simulator/time-off')
      .send({ employeeId: 'emp-1', locationId: 'loc-1', days: 2, requestId: 'req-1' })
      .expect(201);
    expect(second.body.idempotent).toBe(true);

    const hcmBalance = await request(hcmServer).get('/hcm-simulator/balances/emp-1/loc-1').expect(200);
    expect(hcmBalance.body.balanceDays).toBe(8);

    await request(hcmServer)
      .post('/hcm-simulator/time-off')
      .send({ employeeId: 'emp-1', locationId: 'loc-1', days: 3, requestId: 'req-1' })
      .expect(409);
  });

  it('approved request approval retry returns existing approved request', async () => {
    await seedHcm('emp-1', 'loc-1', 10);
    const created = await createRequest(2).expect(201);
    await request(timeOffServer)
      .post(`/time-off-requests/${created.body.id}/approve`)
      .send({ managerId: 'manager-1' })
      .expect(201);

    const retry = await request(timeOffServer)
      .post(`/time-off-requests/${created.body.id}/approve`)
      .send({ managerId: 'manager-1' })
      .expect(201);
    expect(retry.body.status).toBe(TimeOffRequestStatus.Approved);

    const hcmBalance = await request(hcmServer).get('/hcm-simulator/balances/emp-1/loc-1').expect(200);
    expect(hcmBalance.body.balanceDays).toBe(8);
  });

  it('rejecting and cancelling pending requests release reservations', async () => {
    await syncBalance('batch-terminal-release', 10);
    const rejected = await createRequest(3).expect(201);
    const cancelled = await createRequest(2, { requestedBy: 'emp-1' }).expect(201);

    await request(timeOffServer)
      .post(`/time-off-requests/${rejected.body.id}/reject`)
      .send({ managerId: 'manager-1', reason: 'not approved' })
      .expect(201);

    await request(timeOffServer)
      .post(`/time-off-requests/${cancelled.body.id}/cancel`)
      .send({ actorId: 'emp-1', reason: 'changed plans' })
      .expect(201);

    const balance = await request(timeOffServer).get('/balances/emp-1/loc-1').expect(200);
    expect(balance.body.reservedDays).toBe(0);
    expect(balance.body.availableDays).toBe(10);
  });

  it('rejecting and cancelling approving requests are invalid transitions', async () => {
    await syncBalance('batch-approving-transition', 10);
    const rejected = await createRequest(2).expect(201);
    const cancelled = await createRequest(2).expect(201);
    await requestsRepository.update(rejected.body.id, { status: TimeOffRequestStatus.Approving });
    await requestsRepository.update(cancelled.body.id, { status: TimeOffRequestStatus.Approving });

    await request(timeOffServer)
      .post(`/time-off-requests/${rejected.body.id}/reject`)
      .send({ managerId: 'manager-1' })
      .expect(409);

    await request(timeOffServer)
      .post(`/time-off-requests/${cancelled.body.id}/cancel`)
      .send({ actorId: 'emp-1' })
      .expect(409);
  });

  it('terminal statuses reject invalid transitions', async () => {
    await syncBalance('batch-invalid-transitions', 10);
    const created = await createRequest(2).expect(201);
    await request(timeOffServer)
      .post(`/time-off-requests/${created.body.id}/cancel`)
      .send({ actorId: 'emp-1' })
      .expect(201);

    await request(timeOffServer)
      .post(`/time-off-requests/${created.body.id}/reject`)
      .send({ managerId: 'manager-1' })
      .expect(409);
  });

  it('HCM simulator handles external bonus and decrease', async () => {
    await seedHcm('emp-1', 'loc-1', 10);
    await request(timeOffServer).post('/balances/emp-1/loc-1/refresh').expect(201);

    await seedHcm('emp-1', 'loc-1', 12);
    let balance = await request(timeOffServer).post('/balances/emp-1/loc-1/refresh').expect(201);
    expect(balance.body.balanceDays).toBe(12);

    await seedHcm('emp-1', 'loc-1', 4);
    balance = await request(timeOffServer).post('/balances/emp-1/loc-1/refresh').expect(201);
    expect(balance.body.balanceDays).toBe(4);
  });

  it('persists request and sync audit events', async () => {
    await syncBalance('batch-audit', 10);
    const created = await createRequest(2).expect(201);
    await request(timeOffServer)
      .post(`/time-off-requests/${created.body.id}/reject`)
      .send({ managerId: 'manager-1' })
      .expect(201);

    const events = await requestEvents.find({ order: { createdAt: 'ASC' } });
    expect(events.map((event) => event.eventType)).toEqual(['REQUEST_CREATED', 'REQUEST_REJECTED']);
    expect(await syncEvents.count()).toBe(1);
  });

  async function tableNames(dataSource: DataSource): Promise<string[]> {
    const rows = await dataSource.query("SELECT name FROM sqlite_master WHERE type = 'table'");
    return rows.map((row: { name: string }) => row.name);
  }
});
