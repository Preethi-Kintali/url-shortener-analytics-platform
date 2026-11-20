# TICK-01: Seed Database with Initial Providers, Services, and Slots

## 1. Title
`TICK-01: Seed Database with Initial Test Providers, Services, and Fixed Slots`

---

## 2. Context (Why)
SkillSwap's first vertical slice is a demand-side-first walking skeleton that validates the learner booking experience without waiting for a fully functional provider onboarding portal. To enable learners to browse realistic offerings and book sessions on Day 1, the database must be seeded with three realistic provider profiles, one featured service each, and three static bookable slots.

---

## 3. Scope (What)
- Create database migration/schema definitions for SQLite/PostgreSQL tables: `providers`, `services`, and `slots`.
- Author a reproducible database seed script (`seeds/01_seed_providers.ts` or `.sql`) that populates:
  - Exactly 3 distinct providers with names, bio headlines, skill categories, hourly rates, and avatar URLs.
  - Exactly 1 featured service package per provider with title, description, duration (60 minutes), and pricing.
  - Exactly 3 pre-defined available slots per provider for tomorrow (10:00 AM, 2:00 PM, 4:00 PM UTC).
- Ensure the seed script is idempotent (can run multiple times without duplicating rows).

---

## 4. Interface Contract (Data Shapes & Schemas)

### Schema Definitions:
```sql
CREATE TABLE IF NOT EXISTS providers (
  id UUID PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  headline VARCHAR(255) NOT NULL,
  bio TEXT NOT NULL,
  category VARCHAR(50) NOT NULL,
  hourly_rate_cents INTEGER NOT NULL,
  avatar_url VARCHAR(255) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS services (
  id UUID PRIMARY KEY,
  provider_id UUID NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  title VARCHAR(150) NOT NULL,
  description TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 60,
  price_cents INTEGER NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS slots (
  id UUID PRIMARY KEY,
  provider_id UUID NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  start_time TIMESTAMP WITH TIME ZONE NOT NULL,
  end_time TIMESTAMP WITH TIME ZONE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'AVAILABLE', -- 'AVAILABLE', 'HELD', 'BOOKED'
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

### Seed Data Specification:
- **Provider 1:**
  - `id`: `11111111-1111-1111-1111-111111111111`
  - `name`: "Elena Rostova"
  - `headline`: "Principal Engineer & Algorithms Specialist"
  - `category`: "Computer Science"
  - `hourly_rate_cents`: 4500 ($45.00)
  - `service`: "1-on-1 Data Structures & LeetCode Coaching", `duration_minutes`: 60, `price_cents`: 4500
- **Provider 2:**
  - `id`: `22222222-2222-2222-2222-222222222222`
  - `name`: "Marcus Vance"
  - `headline`: "Cloud Architect & Distributed Systems Lead"
  - `category`: "System Design"
  - `hourly_rate_cents`: 6500 ($65.00)
  - `service`: "1-on-1 System Architecture Coaching", `duration_minutes`: 60, `price_cents`: 6500
- **Provider 3:**
  - `id`: `33333333-3333-3333-3333-333333333333`
  - `name`: "Aisha Patel"
  - `headline`: "Staff DevOps & Kubernetes Consultant"
  - `category`: "DevOps"
  - `hourly_rate_cents`: 5500 ($55.00)
  - `service`: "Kubernetes Production Readiness Audit", `duration_minutes`: 60, `price_cents`: 5500

---

## 5. Acceptance Criteria (Given / When / Then)

### Scenario 1: Fresh Database Seeding Execution
- **Given** an empty or cleanly reset database,
- **When** the developer executes `pnpm run db:seed` (or equivalent migration command),
- **Then** the database contains exactly 3 records in `providers`, 3 records in `services`, and 9 records in `slots` (3 per provider).

### Scenario 2: Data Integrity & Foreign Key Relations
- **Given** the seed script has executed,
- **When** querying `services` with `provider_id = '11111111-1111-1111-1111-111111111111'`,
- **Then** exactly 1 service record returns with `title = '1-on-1 Data Structures & LeetCode Coaching'` and `price_cents = 4500`.

### Scenario 3: Slot Availability Preconditions
- **Given** the seed script has executed,
- **When** querying `slots` for any provider,
- **Then** all 3 slots have `status = 'AVAILABLE'` and valid non-overlapping ISO timestamps.

### Scenario 4: Idempotent Execution
- **Given** the seed script has already executed once,
- **When** the developer runs `pnpm run db:seed` a second time,
- **Then** the script completes with exit code 0 without creating duplicate records or throwing unique constraint violations.

---

## 6. Constraints (Rules to Follow)
- Use standard SQL or Prisma/Knex migrations compatible with the project database.
- Use explicit UUID v4 literals for deterministic entity references across dependent tickets.
- All monetary amounts must be stored as integers representing cents (e.g., $45.00 = 4500) to prevent floating-point inaccuracies.
- All timestamps must be in UTC (`TIMESTAMPTZ`).

---

## 7. Anti-Scope (What NOT to Build)
- No user-facing provider registration UI.
- No dynamic calendar generation logic or recurring weekly rules.
- No dynamic timezone conversion helpers.
- No admin approval status flags (`APPROVED`, `SUSPENDED`).
- No provider bank account routing fields.
