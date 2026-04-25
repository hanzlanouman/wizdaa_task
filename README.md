# ExampleHR Time-Off Microservice

ExampleHR Time-Off Microservice is a NestJS + SQLite backend for managing employee time-off requests while treating an external HCM system, such as Workday or SAP, as the source of truth for official balances.

The submission runs as two separate services in one repo:

- **TimeOff Service**: request lifecycle, cached balances, reservations, approval workflow, audit, and HCM batch ingestion.
- **HCM Simulator Service**: separate mock HCM service for realtime balance, apply time off, outage simulation, external balance changes, and batch push simulation.

TimeOff does not import HCM simulator modules/entities or share HCM tables. It calls HCM over HTTP through `HCM_BASE_URL`.

## JavaScript Requirement

The implementation uses NestJS with TypeScript because NestJS is TypeScript-first. It compiles and runs as JavaScript through the normal Nest build/runtime toolchain.

## Prerequisites

- Node.js 22+
- pnpm 10+

Node 22+ is required for the tested runtime and native `fetch`/`AbortController` support used by the HCM HTTP client.

## Install

```bash
pnpm install
```

The project includes pnpm build approval for `sqlite3`, so install should build the native SQLite binding automatically.

## Run Locally

Run the HCM simulator in one terminal:

```bash
pnpm run start:dev:hcm
```

Run the TimeOff service in another terminal:

```bash
HCM_BASE_URL=http://localhost:3001 pnpm run start:dev:timeoff
```

Defaults:

| Variable | Default | Purpose |
|---|---|---|
| `TIMEOFF_PORT` | `3000` | TimeOff HTTP port |
| `HCM_PORT` | `3001` | HCM simulator HTTP port |
| `HCM_BASE_URL` | `http://localhost:3001` | HCM URL used by TimeOff |
| `HCM_TIMEOUT_MS` | `2000` | TimeOff outbound HCM HTTP timeout |
| `TIMEOFF_BASE_URL` | `http://localhost:3000` | TimeOff URL used by HCM batch push |
| `TIMEOFF_DB_PATH` | `data/time-off.sqlite` | TimeOff SQLite path |
| `HCM_DB_PATH` | `data/hcm-simulator.sqlite` | HCM simulator SQLite path |

Production-style compiled run:

```bash
pnpm run build
pnpm run start:prod:hcm
HCM_BASE_URL=http://localhost:3001 pnpm run start:prod:timeoff
```

## Test

```bash
pnpm test:e2e
pnpm test:cov
```

The e2e suite boots both services on random ports, gives each service its own in-memory SQLite database, and verifies the HTTP integration boundary. Focused unit tests cover day conversion and stable hashing utilities. Coverage proof is summarized in [docs/COVERAGE_SUMMARY.md](docs/COVERAGE_SUMMARY.md).

## Requirement Alignment

- **HCM source of truth**: TimeOff stores only cached HCM balances and always revalidates with HCM before approval.
- **External HCM changes**: realtime refresh and batch sync handle work anniversary bonuses, annual refreshes, corrections, and other non-ExampleHR updates.
- **Realtime HCM API**: TimeOff calls HCM over HTTP for balance refresh and approved time-off filing.
- **Batch HCM endpoint**: TimeOff exposes `POST /sync/hcm/balances`, and HCM simulator exposes `POST /hcm-simulator/batch-push`.
- **Defensive HCM handling**: TimeOff checks balance before apply, handles HCM invalid dimensions, insufficient balance, outages, network failure, and timeouts.
- **Test rigor**: e2e tests prove service separation, DB separation, idempotency, stale cache refresh, HCM failures, approval safety, and audit persistence.

## Architecture

- `AppModule`: TimeOff service only.
- `HcmSimulatorAppModule`: HCM simulator service only.
- `BalancesModule`: cached balances, HCM refresh, available balance calculation.
- `TimeOffRequestsModule`: request creation, approval, rejection, cancellation, and idempotency.
- `SyncModule`: HCM batch sync with payload-hash idempotency.
- `AuditModule`: request lifecycle audit events.
- `HcmClientModule`: TimeOff HTTP client for HCM realtime APIs.
- `HcmModule`: HCM simulator balance/apply/config/batch-push endpoints.

Database entity code is also grouped by ownership:

- `src/database/timeoff/`: TimeOff balance, request, audit, and sync entities.
- `src/database/hcm-simulator/`: HCM simulator balance, apply, and config entities.
- `src/database/entities.ts`: shared export boundary that provides separate entity lists to each app module.

Days are stored internally as integer hundredths to avoid floating point drift. For example, `1.50` days is stored as `150`.

## Core Balance Strategy

Available balance is calculated as:

```text
cached HCM balance - PENDING reservations - APPROVING reservations
```

HCM remains authoritative. Local balance is only a cached snapshot used for fast feedback. Approval always validates against realtime HCM before applying time off.

Approval uses a transient `APPROVING` status before calling HCM. This prevents duplicate approval requests from double-deducting the same request. The HCM simulator also records applied `requestId` values so repeated HCM apply calls are idempotent.

Balances are scoped per employee/location. The `balances` table has a unique `(employeeId, locationId)` constraint, and every request, reservation calculation, refresh, approval, and sync operation uses both dimensions.

## Security and Architecture Notes

- DTO validation uses whitelist mode and rejects non-whitelisted fields.
- HCM calls are bounded by `HCM_TIMEOUT_MS` so slow dependencies do not hang TimeOff.
- Request creation, HCM batch sync, and HCM apply are idempotent to make retries safe.
- The HCM simulator is a development/test service and should not be exposed publicly in production.
- Actor fields are audit metadata only; production would add authentication, manager authorization, TLS, HCM credentials/OAuth, rate limiting, structured logs, and database migrations.

## TimeOff API

- `GET /health`
- `GET /balances/:employeeId/:locationId`
- `POST /balances/:employeeId/:locationId/refresh`
- `POST /sync/hcm/balances`
- `POST /time-off-requests`
- `GET /time-off-requests`
- `GET /time-off-requests/:id`
- `POST /time-off-requests/:id/approve`
- `POST /time-off-requests/:id/reject`
- `POST /time-off-requests/:id/cancel`

## HCM Simulator API

- `GET /health`
- `GET /hcm-simulator/balances/:employeeId/:locationId`
- `PUT /hcm-simulator/balances/:employeeId/:locationId`
- `POST /hcm-simulator/time-off`
- `POST /hcm-simulator/config`
- `POST /hcm-simulator/batch-push`
- `POST /hcm-simulator/reset`

## Example Flow

Seed HCM:

```bash
curl -X PUT http://localhost:3001/hcm-simulator/balances/emp-1/loc-1 \
  -H 'Content-Type: application/json' \
  -d '{"balanceDays":10}'
```

Create a request through TimeOff:

```bash
curl -X POST http://localhost:3000/time-off-requests \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: create-emp-1-001' \
  -d '{"employeeId":"emp-1","locationId":"loc-1","days":2,"requestedBy":"emp-1","reason":"Vacation"}'
```

Approve the request:

```bash
curl -X POST http://localhost:3000/time-off-requests/<request-id>/approve \
  -H 'Content-Type: application/json' \
  -d '{"managerId":"manager-1"}'
```

Push HCM corpus to TimeOff batch sync:

```bash
curl -X POST http://localhost:3001/hcm-simulator/batch-push \
  -H 'Content-Type: application/json' \
  -d '{"batchId":"hcm-batch-001"}'
```

Simulate HCM outage:

```bash
curl -X POST http://localhost:3001/hcm-simulator/config \
  -H 'Content-Type: application/json' \
  -d '{"isUnavailable":true}'
```

## Docs

- [docs/TRD.md](docs/TRD.md): technical requirements document.
- [docs/TEST_PLAN.md](docs/TEST_PLAN.md): test strategy and matrix.
- [docs/COVERAGE_SUMMARY.md](docs/COVERAGE_SUMMARY.md): latest coverage proof.

## Assumptions and Non-goals

- HCM is the source of truth for official balances.
- TimeOff owns local request workflow and reservations.
- Real authentication, JWT/session handling, and manager hierarchy are out of scope.
- Leave types, holidays, weekends, accrual policies, and approval reversal are out of scope.
- TypeORM `synchronize: true` is used for take-home simplicity; production would use migrations.

## Packaging

Create a submission zip with:

```bash
pnpm run zip
```

The zip script excludes `node_modules`, `dist`, `coverage`, `.git`, local DB files, logs, and caches. The final zip should stay well under the 50 MB limit.
