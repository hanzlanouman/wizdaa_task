# ExampleHR Time-Off Microservice

ExampleHR Time-Off Microservice is a NestJS + SQLite backend for managing employee time-off requests while treating an external HCM system, such as Workday or SAP, as the source of truth for official balances.

Repository: https://github.com/hanzlanouman/wizdaa_task/

The system runs as two separate services in one repository:

- **TimeOff Service**: request lifecycle, cached balances, reservations, approval workflow, audit events, and HCM batch ingestion.
- **HCM Simulator Service**: separate mock HCM service for realtime balance lookup, time-off apply, outage simulation, external balance changes, and batch push simulation.

TimeOff does not import HCM simulator modules/entities or share HCM tables. It calls HCM over HTTP through `HCM_BASE_URL`.

## Documentation

- [docs/TRD.md](docs/TRD.md): engineering specification, architecture decisions, API design, failure modes, security considerations, alternatives, and future improvements.
- [docs/TEST_PLAN.md](docs/TEST_PLAN.md): test strategy and scenario matrix.
- [docs/COVERAGE_SUMMARY.md](docs/COVERAGE_SUMMARY.md): latest coverage summary.

## Runtime

- Node.js 22+
- pnpm 10+

The implementation uses NestJS with TypeScript because NestJS is TypeScript-first. It compiles and runs as JavaScript through the standard Nest build/runtime toolchain.

## Install

```bash
pnpm install
```

## Run Locally

Run the HCM simulator in one terminal:

```bash
pnpm run start:dev:hcm
```

Run the TimeOff service in another terminal:

```bash
HCM_BASE_URL=http://localhost:3001 pnpm run start:dev:timeoff
```

Default local configuration:

| Variable | Default | Purpose |
|---|---|---|
| `TIMEOFF_PORT` | `3000` | TimeOff HTTP port |
| `HCM_PORT` | `3001` | HCM simulator HTTP port |
| `HCM_BASE_URL` | `http://localhost:3001` | HCM URL used by TimeOff |
| `HCM_TIMEOUT_MS` | `2000` | TimeOff outbound HCM HTTP timeout |
| `TIMEOFF_BASE_URL` | `http://localhost:3000` | TimeOff URL used by HCM batch push |
| `TIMEOFF_DB_PATH` | `data/time-off.sqlite` | TimeOff SQLite path |
| `HCM_DB_PATH` | `data/hcm-simulator.sqlite` | HCM simulator SQLite path |

Compiled run:

```bash
pnpm run build
pnpm run start:prod:hcm
HCM_BASE_URL=http://localhost:3001 pnpm run start:prod:timeoff
```

## Verify

```bash
pnpm run build
pnpm test
pnpm test:e2e
pnpm test:cov
```

Create the distribution archive:

```bash
pnpm run zip
```

The archive script excludes `node_modules`, `dist`, `coverage`, `.git`, local DB files, logs, caches, and SQLite files.

## Example Flow

Seed HCM:

```bash
curl -X PUT http://localhost:3001/hcm-simulator/balances/emp-1/loc-1 \
  -H 'Content-Type: application/json' \
  -d '{"balanceDays":10}'
```

Read a fresh employee-facing balance:

```bash
curl "http://localhost:3000/balances/emp-1/loc-1?fresh=true"
```

Create a request through TimeOff:

```bash
curl -X POST http://localhost:3000/time-off-requests \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: create-emp-1-001' \
  -d '{"employeeId":"emp-1","locationId":"loc-1","days":2,"requestedBy":"emp-1","reason":"Vacation"}'
```

Validate the request for a manager review screen:

```bash
curl -X POST http://localhost:3000/time-off-requests/<request-id>/validate
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
