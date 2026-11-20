# Team Collaboration Platform — Production Setup & Onboarding Guide

**Audience**: New Software Engineers & SREs  
**System Target**: Node.js 20+, PostgreSQL 16, Redis 7+  
**Standard**: Hermetic, Zero-Tribal-Knowledge Setup  

Follow this sequential checklist on a fresh development machine. Do not skip steps.

---

## Prerequisites
- Node.js LTS (v20.x or v22.x)
- pnpm (v9.x or later): `corepack enable && corepack prepare pnpm@latest --activate`
- Docker & Docker Compose (for local PostgreSQL and Redis instances)
- Git (v2.40+)

---

## Step-by-Step Setup

### Step 1: Clone Repository & Checkout Main Branch
```bash
git clone git@github.com:knack/team-collaboration-api.git
cd team-collaboration-api
git checkout main
```

### Step 2: Configure Environment Variables
Copy the sanitized environment template to create your local `.env`:
```bash
cp .env.example .env
```
Ensure the following keys are populated in `.env`:
```ini
PORT=3000
NODE_ENV=development
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/collaboration_db?schema=public"
REDIS_URL="redis://localhost:6379"
JWT_SECRET="dev_only_super_secure_signing_secret_do_not_use_in_prod"
JWT_EXPIRATION="86400s"
INVITATION_EXPIRATION_DAYS=7
LOG_LEVEL=debug
```

### Step 3: Start Infrastructure Services via Docker Compose
Start local PostgreSQL and Redis instances in background daemon mode:
```bash
docker compose up -d postgres redis
```
Verify containers are healthy:
```bash
docker compose ps
```

### Step 4: Install Dependencies with Frozen Lockfile
Install all production and development dependencies using pinned lockfile:
```bash
pnpm install --frozen-lockfile
```
*Verification*: Confirm zero peer-dependency warnings and exit code 0.

### Step 5: Execute Database Migrations
Apply Prisma database migrations to create the clean schema:
```bash
pnpm prisma migrate deploy
```
Generate the Prisma Client types:
```bash
pnpm prisma generate
```

### Step 6: Seed Local Database with Baseline Data
Populate roles, sample test tenants, and development user accounts:
```bash
pnpm prisma db seed
```
*Result*: Populates `team_alpha` (owner: `usr_alice`), `team_beta` (owner: `usr_charlie`), and seed credentials.

### Step 7: Execute Local Verification Test Suite
Run the comprehensive regression and end-to-end integration suites:
```bash
pnpm test
```
*Expected Output*: All 27 production tests and 18 integration tests passing (100% green).

### Step 8: Start the Application Service
Launch the NestJS development server with file watching:
```bash
pnpm start:dev
```
Verify service liveness:
```bash
curl -f http://localhost:3000/health
```
Expected response:
```json
{ "status": "ok", "uptime": 2.4, "database": "connected", "redis": "connected" }
```
You are now ready to develop, review, and ship features.
