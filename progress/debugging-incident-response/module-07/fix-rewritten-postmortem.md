# Postmortem (Rewritten): PostgreSQL Users Table Index Drop Outage

**Incident Date**: 2024-03-15  
**Severity**: SEV1  
**Lead Reviewer**: SRE / Database Reliability Engineering  
**Status**: Resolved | Remediations In Progress  

---

## 1. Executive Summary
On Friday, March 15, 2024, at 14:15 UTC, a database migration was deployed to production that unintentionally dropped the primary index on `users(email)`. The missing index caused query execution plans on user authentication routes to degrade from $O(\log N)$ index lookups to $O(N)$ sequential table scans, resulting in severe CPU saturation, connection pool exhaustion, and widespread login request timeouts. Approximately 14,200 users experienced authentication failures over a 16-hour window until the migration was rolled back and the index reconstructed at 06:30 UTC on March 16.

---

## 2. Systemic Root Cause
The CI/CD deployment pipeline did not enforce automated migration validation against a staging environment with production-scale data before applying DDL schema mutations to the production PostgreSQL cluster. Consequently, an unindexed query path on the `users` table bypassed static linting, resulting in catastrophic query latency degradation in production.

---

## 3. Systemic Contributing Factors

1. **Absence of Pre-Deployment Migration Testing in CI**:
   The automated build pipeline lacked an automated database migration verification step to assert that critical index constraints and query latency invariants were maintained prior to merge.
2. **Missing Pull Request Review Enforcement for Schema Mutations**:
   Branch protection rules on the repository permitted DDL migration scripts to merge without mandatory sign-off from designated database domain experts (CODEOWNERS).
3. **Absence of Weekend Deployment Freeze Policy**:
   The release management process lacked an automated or enforced deployment freeze window preceding weekends, allowing non-emergency DDL changes to deploy without dedicated on-call staffing.
4. **Telemetry Detection Gaps for Database Query Degeneracies**:
   Monitoring alarms were configured exclusively for web server error rates rather than underlying database engine metrics (e.g. sudden spikes in sequential scans on critical tables or connection wait queue depths).

---

## 4. Impact
- **Outage Duration**: 16 hours and 15 minutes (2024-03-15 14:15 UTC to 2024-03-16 06:30 UTC).
- **Users Affected**: 14,200 unique user accounts experienced login timeouts; public API read routes remained operational.
- **Data Impact**: Zero permanent data corruption or loss. 100% of user records remained intact.

---

## 5. Actionable Remediation Items

| # | Action Description | Owner | Target Completion | Status |
| :--- | :--- | :--- | :--- | :--- |
| **1** | Implement automated migration dry-run CI check executing `EXPLAIN ANALYZE` on core query paths against synthetic 1M-row staging dataset | **Database Engineering** | End of Sprint 14 | **Open** |
| **2** | Configure GitHub CODEOWNERS to mandate approved review from Database Engineering for any changes in `migrations/` | **DevOps / Platform** | End of Sprint 13 | **Open** |
| **3** | Implement automated deployment freeze in CI pipeline blocking non-emergency production releases after 12:00 UTC on Fridays | **Release Engineering** | End of Sprint 13 | **Open** |
| **4** | Configure Prometheus alert on `pg_stat_user_tables.seq_scan` rate $> 5$ scans/min on `users` table with PagerDuty escalation | **SRE Team** | End of Sprint 14 | **Open** |

---

## 6. Lessons Learned

### What Went Well
- Database transaction rollback scripts executed cleanly without schema deadlock or corrupted secondary keys once initiated.
- User data integrity was preserved with zero data corruption.

### What Went Poorly
- Time to Detection (TTD) was over 3 hours because customer support escalations preceded internal telemetry alarms.
- Deployment occurred without adequate monitoring coverage for table scan rates.

### Where We Got Lucky
- The migration dropped an index rather than dropping a column or table, enabling instantaneous index reconstruction via `CREATE INDEX CONCURRENTLY` without data loss or table locks.
