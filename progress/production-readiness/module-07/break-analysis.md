# Module 07: Runbooks & Operational Docs - Break Analysis

## 1. Real-World Runbook Failure Scenarios Diagnosed

### Scenario A: Stale Runbook (Container / Host Drift)
- **Symptom:** The on-call engineer copy-pastes `docker logs myservice-prod` as documented in the runbook, but the terminal returns:
  `Error response from daemon: No such container: myservice-prod`
- **Root Cause:** Deployment scripts were updated to tag the container as `myservice-api-prod` or dynamic container IDs were assigned, but documentation was not updated in lockstep.
- **Remediation:** Provide resilient container discovery commands utilizing label/name filtering:
  `$CID = docker ps -q --filter "name=myservice" | Select-Object -First 1; docker logs $CID`

---

### Scenario B: Missing Step (Cold-Start Socket Stabilization & Connection Re-establishment)
- **Symptom:** The runbook instructs the engineer to restart the PostgreSQL container and immediately run `curl http://localhost:3000/ready`. The probe fails with HTTP 503, causing the engineer to conclude the database is still broken and falsely escalating to the Director.
- **Root Cause:** PostgreSQL daemon requires 1–3 seconds to complete internal initialization, replay WAL logs, and bind to port 5432. Simultaneously, Prisma Client connection pool backoff timers require 1–2 seconds to re-establish idle sockets.
- **Remediation:** Add an explicit stabilization delay and bounded probe retry loop in the runbook verification section:
  ```powershell
  # Wait 3 seconds for socket binding, then poll /ready up to 5 times
  Start-Sleep -Seconds 3
  for ($i=1; $i -le 5; $i++) {
    $res = curl -s http://localhost:3000/ready
    if ($res -match '"ok":true') { Write-Output "Recovered!"; break }
    Start-Sleep -Seconds 2
  }
  ```

---

### Scenario C: Ambiguous Port / Target Drift
- **Symptom:** Running `curl -s http://localhost:3000/live` fails with connection refused or hits an unrelated proxy because the service is running on `$PORT=3001` or behind an ingress gateway.
- **Root Cause:** Documented curl commands hardcoded port 3000 without documenting port resolution.
- **Remediation:** Explicitly document port fallback resolution:
  `$PORT = if ($env:PORT) { $env:PORT } else { "3000" }; curl -s http://localhost:$PORT/live`
