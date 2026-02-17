# Nebular News API v2 Contract

## Envelope

All new v2 endpoints use an envelope with deterministic shape:

```json
{
  "ok": true,
  "data": {},
  "request_id": "..."
}
```

Error envelope:

```json
{
  "ok": false,
  "error": {
    "code": "bad_request",
    "message": "Human-readable failure"
  },
  "request_id": "..."
}
```

All API responses include `x-request-id`.

## Pull Endpoints

- `POST /api/pull`
  - Starts a durable pull run.
  - Response includes `run_id`, `started`, and `cycles`.
- `GET /api/pull/status?run_id=<id>`
  - Returns durable status for a specific run when provided, otherwise latest.
- `GET /api/pull`
  - Backward-compatible alias returning latest run fields.

## Job Run Endpoint

- `GET /api/jobs/:id/runs`
  - Returns job attempt history from `job_runs`.

## Health and Readiness

- `GET /api/health`
  - Liveness signal.
- `GET /api/ready`
  - Readiness signal including schema version checks.
