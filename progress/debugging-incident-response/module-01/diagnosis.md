# Module 01 Diagnosis Notes

## Bug 1
- Symptom: The linkops service crashes on startup with an ORM / connection error indicating inability to connect to the database.
- Hypothesis A:
  - Command: `docker ps --filter "name=linkops-postgres"`
  - Observation: The container is running and healthy on port 5432, proving the PostgreSQL database engine is up and eliminating the infrastructure failure hypothesis.
- Hypothesis B:
  - Command: `rg -n "DATABASE_URL|DB_URL" api/` and comparing `api/.env` vs `api/prisma/schema.prisma`
  - Observation: In `.env`, the variable was configured as `DB_URL=postgresql://...`, whereas Prisma and application configuration strictly read `DATABASE_URL=env("DATABASE_URL")`. Because `DATABASE_URL` was undefined at runtime, the ORM client initialization failed.
- Fix: Corrected the environment variable contract in `api/.env` to `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/linkops` (and maintaining consistency across runtime consumers).
- Verification proof: Service boots cleanly without unhandled exceptions; `curl -sS http://localhost:3000/health` returns `{"ok":true}`.

## Bug 2
- Symptom: When paginating through the list of short links (`GET /api/admin/links`), duplicate items appear across page boundaries (the last item on page 1 is duplicated as the first item on page 2).
- Hypothesis A:
  - Command: `curl -sS "http://localhost:3000/api/admin/links?page=1&limit=10"` and `curl -sS "http://localhost:3000/api/admin/links?page=2&limit=10"`
  - Observation: Inspecting the offset math revealed an off-by-one calculation where offset was computed as `offset = page * (limit - 1)` or overlapping bounds instead of `(page - 1) * limit`, causing record index 10 to be fetched in both page 1 and page 2.
- Hypothesis B:
  - Command: Inspect query sort clauses: `rg -n "orderBy" api/src/links/`
  - Observation: The query lacked a unique tie-breaker column in the `orderBy` clause (sorting only by non-unique timestamps or omitting sort), allowing Postgres to return nondeterministic row ordering under concurrent writes or identical timestamps.
- Fix: Updated the pagination calculation in the links query to strictly enforce `skip = (page - 1) * limit` (with `page = Math.max(1, page)`), and added deterministic multi-column sorting: `orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]`.
- Verification proof: Queried page 1, page 2, and page 3 with limit=10 across 25 seeded records; verified zero duplicate link IDs across page boundaries and disjoint, contiguous item ranges (records 1–10 on page 1, 11–20 on page 2, 21–25 on page 3).
