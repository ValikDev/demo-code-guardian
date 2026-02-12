# Code Guardian

Backend service wrapping the [Trivy](https://trivy.dev/) security scanner.
Designed to process massive scan reports (500 MB+) under strict memory constraints (256 MB RAM) without crashing.

**Key points:**

- Async scan pipeline: `POST /api/scan` returns immediately, background worker clones repo → runs Trivy → streams JSON
- Memory-safe: `stream-json` parses Trivy output object-by-object — never loads the full file into memory
- Process isolation: worker runs as a forked child with `--max-old-space-size=150`; if it OOMs, the orchestrator survives
- Bounded queue: rejects excess jobs with `429`, capped in-memory registry with LRU eviction
- Dual API: REST (`/api/scan`) and GraphQL (`/graphql`) coexist on the same server
- React frontend: scan form, 2s polling, vulnerability display, REST/GraphQL toggle

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| **Node.js** | ≥ 22 | `node -v` |
| **pnpm** | 9.x | `corepack enable pnpm` |
| **Git** | any | for cloning repos |
| **Trivy** | any | `brew install trivy` or [install docs](https://trivy.dev/latest/getting-started/installation/) |
| **Docker** | optional | only for containerised run |

## Install

```bash
git clone <repo-url> && cd cg-service
pnpm install
```

## Run

### Local development

```bash
# Backend only (port 4000, hot reload)
pnpm dev

# Frontend only (port 5173, proxies /api → :4000)
pnpm dev:web

# Both at once
pnpm dev:all
```

### Docker (200 MB memory limit)

```bash
docker-compose up --build
```

### OOM self-test

```bash
node --max-old-space-size=150 --import tsx packages/orchestrator/src/server.ts
```

## Test

### Unit tests (fast, no network or external tools required)

```bash
pnpm test
```

### Integration tests (requires network + trivy installed)

```bash
pnpm test:integration
```

### All tests

```bash
pnpm test:all
```

### Lint & type-check

```bash
pnpm lint
pnpm build        # tsc --build
```

### Manual (curl)

```bash
# Start a scan
curl -s -X POST http://localhost:4000/api/scan \
  -H 'Content-Type: application/json' \
  -d '{"repoUrl":"https://github.com/OWASP/NodeGoat"}' | jq

# Poll status (replace <scanId>)
curl -s http://localhost:4000/api/scan/<scanId> | jq

# GraphQL
curl -s -X POST http://localhost:4000/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"mutation { startScan(repoUrl: \"https://github.com/OWASP/NodeGoat\") { scan { scanId status } error { message } } }"}' | jq

# Health
curl http://localhost:4000/health
```

## Architecture

```
┌─────────────┐     ┌──────────────────────────────────────────────────┐
│   Browser    │     │              Orchestrator (Node.js)              │
│  React App   │────▶│                                                  │
│  (Vite)      │     │  ┌────────────┐  ┌───────────┐  ┌───────────┐  │
└─────────────┘     │  │ Controller │  │ Job Queue │  │  Registry  │  │
                     │  │ REST + GQL │─▶│ bounded   │─▶│ bounded   │  │
                     │  └────────────┘  │ FIFO      │  │ LRU evict │  │
                     │                  └─────┬─────┘  └─────▲─────┘  │
                     │                        │              │         │
                     │                  ┌─────▼─────┐        │         │
                     │                  │  Worker   │   IPC  │         │
                     │                  │  Manager  │────────┘         │
                     │                  └─────┬─────┘                  │
                     └────────────────────────┼────────────────────────┘
                                              │ fork()
                     ┌────────────────────────▼────────────────────────┐
                     │          Engine (forked child process)           │
                     │          --max-old-space-size=150                │
                     │                                                  │
                     │  git clone ──▶ trivy fs ──▶ stream-json parse   │
                     │  (shallow)     (JSON out)   (object-by-object)  │
                     │                                                  │
                     │  Sends IPC: status | vulns (batches) | error    │
                     └──────────────────────────────────────────────────┘
```

### Happy path sequence

```
Client              Orchestrator                    Engine (fork)
  │                      │                               │
  │  POST /api/scan      │                               │
  │─────────────────────▶│                               │
  │  202 {scanId,Queued} │                               │
  │◀─────────────────────│                               │
  │                      │  fork(worker.ts)              │
  │                      │──────────────────────────────▶│
  │                      │  IPC: start {scanId,repoUrl}  │
  │                      │──────────────────────────────▶│
  │                      │                               │
  │                      │  IPC: status → Scanning       │
  │                      │◀──────────────────────────────│  git clone --depth 1
  │                      │                               │  trivy fs --format json
  │  GET /api/scan/:id   │                               │  stream-json parse
  │─────────────────────▶│                               │
  │  200 {Scanning}      │                               │
  │◀─────────────────────│                               │
  │                      │  IPC: vulns [batch 1..N]      │
  │                      │◀──────────────────────────────│
  │                      │  IPC: status → Finished       │
  │                      │◀──────────────────────────────│
  │                      │                               │  cleanup + exit(0)
  │  GET /api/scan/:id   │                               │
  │─────────────────────▶│                               │
  │  200 {Finished,      │                               │
  │       vulns:[...]}   │                               │
  │◀─────────────────────│                               │
```

### Unhappy path sequences

**Worker crashes (OOM / Trivy failure / clone failure):**

```
Client              Orchestrator                    Engine (fork)
  │                      │                               │
  │  POST /api/scan      │                               │
  │─────────────────────▶│  fork + IPC: start            │
  │  202 {scanId,Queued} │──────────────────────────────▶│
  │◀─────────────────────│                               │
  │                      │  IPC: status → Scanning       │
  │                      │◀──────────────────────────────│
  │                      │                               │  git clone fails
  │                      │  IPC: error {CLONE_FAILED}    │  ── or ──
  │                      │◀──────────────────────────────│  trivy OOM / SIGKILL
  │                      │                               │  exit(non-zero)
  │                      │                               │
  │                      │  on('exit'): detect crash     │
  │                      │  registry → Failed            │
  │                      │  queue.onJobComplete()        │
  │                      │                               │
  │  GET /api/scan/:id   │                               │
  │─────────────────────▶│                               │
  │  200 {Failed,        │                               │
  │   error:{code,msg}}  │                               │
  │◀─────────────────────│                               │
```

**Queue full (flood protection):**

```
Client              Orchestrator
  │                      │
  │  POST /api/scan      │  queue.pending >= maxQueued
  │─────────────────────▶│
  │  429 {error,         │
  │       retryAfter:30} │
  │◀─────────────────────│
```

**Worker timeout:**

```
Client              Orchestrator                    Engine (fork)
  │                      │                               │
  │  POST /api/scan      │  fork + IPC: start            │
  │─────────────────────▶│──────────────────────────────▶│
  │  202 {scanId,Queued} │                               │
  │◀─────────────────────│                               │  ... hangs ...
  │                      │                               │
  │                      │  setTimeout fires (5 min)     │
  │                      │  registry → Failed {TIMEOUT}  │
  │                      │  child.kill(SIGKILL)          │
  │                      │  queue.onJobComplete()        │
  │                      │                               │
  │  GET /api/scan/:id   │                               │
  │─────────────────────▶│                               │
  │  200 {Failed,        │                               │
  │   error:{TIMEOUT}}   │                               │
  │◀─────────────────────│                               │
```

## Project structure

```
packages/
  shared/         Type definitions, IPC protocol
  orchestrator/   Express server, REST + GraphQL, job queue, scan registry, worker manager
  engine/         Forked worker: git-clone → trivy-scanner → stream-parser
  web/            React + Vite + Tailwind frontend
```
