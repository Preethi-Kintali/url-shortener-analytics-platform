# Module 07: Runbooks & Operational Docs - Context

## 1. 3 AM Memory Recall Assessment

### Environment Variables & Configurations
| Variable | Criticality | Target Downstream Component |
|---|---|---|
| `DATABASE_URL` | High (Fail-fast) | PostgreSQL relational storage via Prisma Client |
| `REDIS_URL` | Medium | In-memory Redis L1 cache & BullMQ queue storage |
| `JWT_SECRET` | High (Fail-fast) | In-process stateless cryptographic JWT token verification |
| `PORT` | Medium | Express/NestJS HTTP listener port (default 3000) |
| `NODE_ENV` / `APP_ENV` | High | Environment tier toggling validation and logger modes |
| `LOG_LEVEL` | Low | Logging filter threshold (`debug`, `info`, `warn`, `error`) |

### Dependency Chain
1. **PostgreSQL:** Authoritative store for user accounts, short-link mappings, and metadata.
2. **Redis:** Fast cache for URL redirects and underlying message queue transport for BullMQ.
3. **BullMQ:** Asynchronous click analytics worker queue.
4. **Platform Infrastructure:** Host kernel networking, container runtime (Docker daemon), and VPC internal DNS.

---

## 2. Immediate 3 AM Triage Protocol (First 3 Commands)

### Command 1: Check Container Liveness & Restart Loops
```powershell
docker ps -a --filter "name=myservice"
```
- **Diagnostic Objective:** Check if the container is running, exiting with non-zero exit codes, or trapped in a crash-restart loop (`CrashLoopBackOff`).

### Command 2: Capture Recent Telemetry & Error Signatures
```powershell
$cid = docker ps -q --filter "name=myservice" | Select-Object -First 1; if ($cid) { docker logs --since 15m --tail 200 $cid } else { Write-Output "No running myservice container found" }
```
- **Diagnostic Objective:** Inspect recent uncaught exceptions, database connection pool exhaustion (`P1001`/`P1002`), `circuit_opened` alerts, and extract `request_id` values from structured log lines.

### Command 3: Evaluate Resource Saturation
```powershell
docker stats --no-stream
```
- **Diagnostic Objective:** Spot CPU spikes (runaway retry loops or event loop blocking), memory creep (impending OOM kill), and network socket saturation.

**Operational Rule:** Never restart or destroy a container before collecting log and metric evidence; a premature restart blinds post-incident analysis and often fails to resolve persistent downstream partitions.
