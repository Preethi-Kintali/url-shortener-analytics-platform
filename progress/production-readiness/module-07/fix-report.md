# Module 07: Runbooks & Operational Docs - Fix Report

## 1. Documentation Divergences Identified & Hardened

### Divergence 1: Brittle Container Name Hardcoding
- **Issue:** Relying on exact string `myservice-prod` fails if container naming conventions evolve (e.g. `myservice-api-prod` or ephemeral test containers).
- **Hardening Applied:** Replaced static container references across Runbooks 1, 2, and 3 with dynamic label/name resolution:
  ```powershell
  $CID = docker ps -q --filter "name=myservice" | Select-Object -First 1; if ($CID) { docker logs --since 5m --tail 50 $CID } else { docker logs --since 5m --tail 50 myservice-prod }
  ```

### Divergence 2: Premature Verification Probing (Cold-Start Flap)
- **Issue:** Immediately executing `curl http://localhost:3000/ready` right after `docker start upsk-sdf-postgres` caused false 503 failures because PostgreSQL was still replaying WAL logs and Prisma Client had not completed TCP handshake reconnects.
- **Hardening Applied:** Injected a 3-second stabilization delay followed by a bounded 5-attempt polling loop with 2-second backoff:
  ```powershell
  Start-Sleep -Seconds 3
  for ($i=1; $i -le 5; $i++) {
    $res = curl -s http://localhost:$PORT/ready
    if ($res -match '"ok":true') { Write-Output "Recovered: $res"; break }
    Start-Sleep -Seconds 2
  }
  ```

### Divergence 3: Dynamic Port Binding Omission
- **Issue:** Verification commands assumed port 3000 unconditionally, breaking in multi-instance or staging deployments using alternate ports.
- **Hardening Applied:** Pre-pended `$PORT = if ($env:PORT) { $env:PORT } else { "3000" }` to all curl verification snippets.

---

## 2. End-to-End Re-Verification
- Executed `test-runbook-drill.js` against the updated runbook:
  - Phase 1 (Simulation): PostgreSQL stopped.
  - Phase 2 (Diagnosis): Container status matched expected `Exited` string.
  - Phase 3 (Fix): Container started cleanly.
  - Phase 4 (Stabilization & Verification): Container status returned to `Up`, port 5432 verified reachable.
  - Final Discrepancy Count: **0**.
