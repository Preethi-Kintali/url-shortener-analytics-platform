# Module 02: Team Collaboration Feature — Atomic Task Tree & Prompts

## 1. Feature Specification & Planning Bounds
- **Spec:** *"Add team collaboration to the project management app."*
- **Planning Stance:** Top-Down Decomposition (Option A).
- **Constraints Enforced:**
  - Every task is atomic: describes a single testable unit of work.
  - Acceptance criteria are verifiable externally (HTTP status, curl, DB query, CLI exit code) without reading source code.
  - Strict line limit: **$\le$ 150 lines of code changed per task**.
  - Total tasks: **9 tasks** (exceeds 8+ requirement).
  - Explicit interface contracts defined across task boundaries.

---

## 2. Complete Task Tree (9 Tasks)

```
[Task 1: Team & Member Prisma Schema] ──────┬────────────────────────────────┐
                 │                          │                                │
                 ▼                          ▼                                │
[Task 2: Team Module & POST /teams]  [Task 5: Invitation Schema]             │
        │                │                  │                                │
        ▼                │                  ▼                                │
[Task 3: GET /teams/:id] │           [Task 6: POST /teams/:id/invitations]   │
        │                │                  │                                │
        ▼                ▼                  ▼                                │
[Task 4: Team Role Guard & Decorator] [Task 7: POST /invitations/:token/accept]
        │                                   │                                │
        ├───────────────────────────────────┴─────────────────┐              │
        ▼                                                     ▼              ▼
[Task 8: Revocation & Expiry Management]            [Task 9: Team-Scoped Link Isolation]
```

### Critical Path & Riskiest Task Identification
- **Critical Path (Longest Sequential Chain):**
  $$\text{Task 1} \longrightarrow \text{Task 2} \longrightarrow \text{Task 4} \longrightarrow \text{Task 6} \longrightarrow \text{Task 7}$$
  *Total Length: 5 sequential dependencies.* Minimum architectural sequence required before users can send and accept invitations.
- **Riskiest Task:**
  **Task 7 (Team Invitation Acceptance Endpoint):**
  *Why:* Involves cross-cutting security boundaries, token verification, expiration check, and concurrent state transitions. It requires an atomic database transaction (`prisma.$transaction`) to update invitation status from `PENDING` to `ACCEPTED` while inserting a `TeamMember` row. Failure to enforce atomicity or email verification introduces replay vulnerabilities, race conditions, or unauthorized team takeovers.

---

### Task Specifications

#### Task 1: Team & Membership Prisma Schema Migration
- **Context Needed:** [schema.prisma](../../../api/prisma/schema.prisma), [api/prisma/migrations/](../../../api/prisma/migrations)
- **Expected Output:** Updated `api/prisma/schema.prisma` with `Team` and `TeamMember` models, and migration file `api/prisma/migrations/YYYYMMDDHHMMSS_create_teams_and_members/migration.sql`.
- **Estimated Diff:** ~65 lines.
- **Dependencies:** None (root task).
- **External Acceptance Criteria:**
  - Running `npx prisma migrate dev --name create_teams_and_members` exits with code 0.
  - `psql -c "\d teams"` confirms columns `id` (UUID), `name` (VARCHAR), `created_at`, `updated_at`, `owner_id`.
  - `psql -c "\d team_members"` confirms unique constraint on `(team_id, user_id)` and foreign key cascade to `teams`.

#### Task 2: Team Module Foundation & Creation API (`POST /teams`)
- **Context Needed:** [app.module.ts](../../../api/src/app.module.ts), [jwt-auth.guard.ts](../../../api/src/auth/guards/jwt-auth.guard.ts), [current-user.decorator.ts](#prompt-2-task-2-team-module-foundation--creation-api-post-teams), [prisma.service.ts](../../../api/src/prisma/prisma.service.ts)
- **Expected Output:**
  - `api/src/teams/teams.module.ts`
  - `api/src/teams/teams.controller.ts`
  - `api/src/teams/teams.service.ts`
  - `api/src/teams/dto/create-team.dto.ts`
- **Estimated Diff:** ~125 lines.
- **Dependencies:** Task 1.
- **External Acceptance Criteria:**
  - `POST /teams` with `{ "name": "Platform Core" }` and valid JWT returns HTTP 201 with `{ "id": "...", "name": "Platform Core", "ownerId": "..." }` and automatically creates an `OWNER` membership row in `team_members`.
  - `POST /teams` with `{ "name": "" }` returns HTTP 400 Bad Request.
  - `POST /teams` without Bearer token returns HTTP 401 Unauthorized.

#### Task 3: Team Retrieval & Member List Endpoints (`GET /teams/:id`, `GET /teams/:id/members`)
- **Context Needed:** `api/src/teams/teams.service.ts`, `api/src/teams/teams.controller.ts`, [jwt-auth.guard.ts](../../../api/src/auth/guards/jwt-auth.guard.ts)
- **Expected Output:** Updated `teams.controller.ts` and `teams.service.ts` implementing read endpoints with pagination.
- **Estimated Diff:** ~95 lines.
- **Dependencies:** Task 2.
- **External Acceptance Criteria:**
  - `GET /teams/:id` returns HTTP 200 with team details when caller is an active member.
  - `GET /teams/:id` returns HTTP 403 Forbidden when caller is not a member of the team.
  - `GET /teams/:id/members` returns HTTP 200 with array of members including `userId`, `role`, and `joinedAt`.

#### Task 4: Team Role Guard & Authorization Decorator
- **Context Needed:** [jwt-auth.guard.ts](../../../api/src/auth/guards/jwt-auth.guard.ts), `api/src/teams/teams.service.ts`
- **Expected Output:**
  - `api/src/teams/guards/team-role.guard.ts`
  - `api/src/teams/decorators/roles.decorator.ts`
  - `api/src/teams/enums/team-role.enum.ts`
- **Estimated Diff:** ~85 lines.
- **Dependencies:** Task 2, Task 3.
- **External Acceptance Criteria:**
  - Attaching `@Roles(TeamRole.ADMIN)` to a test endpoint returns HTTP 200 for team `OWNER` or `ADMIN`.
  - Request to the same endpoint from a user with role `MEMBER` returns HTTP 403 Forbidden with `{ "statusCode": 403, "message": "Insufficient team permissions" }`.
  - Non-existent team ID returns HTTP 404 or 403 without uncaught 500 exceptions.

#### Task 5: Team Invitation Prisma Schema Migration
- **Context Needed:** [schema.prisma](../../../api/prisma/schema.prisma)
- **Expected Output:** Updated `schema.prisma` with `TeamInvitation` model and migration file `create_team_invitations`.
- **Estimated Diff:** ~50 lines.
- **Dependencies:** Task 1.
- **External Acceptance Criteria:**
  - `npx prisma migrate dev --name create_team_invitations` executes with exit code 0.
  - `psql -c "\d team_invitations"` confirms fields: `id`, `team_id`, `email`, `role`, `token_hash`, `status` (PENDING, ACCEPTED, REVOKED, EXPIRED), `expires_at`, `invited_by`, `created_at`.
  - Index on `token_hash` exists for $O(1)$ token lookup.

#### Task 6: Team Invitation Dispatch Endpoint (`POST /teams/:id/invitations`)
- **Context Needed:** `api/src/teams/teams.controller.ts`, `api/src/teams/guards/team-role.guard.ts`, `api/src/teams/dto/invite-member.dto.ts`
- **Expected Output:**
  - `api/src/teams/dto/invite-member.dto.ts`
  - Updated `teams.controller.ts` and `teams.service.ts`
- **Estimated Diff:** ~115 lines.
- **Dependencies:** Task 4, Task 5.
- **External Acceptance Criteria:**
  - `POST /teams/:id/invitations` with `{ "email": "dev@knack.io", "role": "MEMBER" }` by an ADMIN returns HTTP 201 with invitation payload (token securely generated, expiration set to $T+7$ days).
  - Attempting to invite an existing team member returns HTTP 409 Conflict.
  - Attempting to invite with role `OWNER` returns HTTP 400 Bad Request.

#### Task 7: Team Invitation Acceptance Endpoint (`POST /invitations/:token/accept`)
- **Context Needed:** `api/src/teams/teams.service.ts`, `api/src/teams/teams.controller.ts`, [prisma.service.ts](../../../api/src/prisma/prisma.service.ts)
- **Expected Output:**
  - `api/src/teams/invitations.controller.ts`
  - Method `acceptInvitation(token, userId)` in `teams.service.ts` using `prisma.$transaction`.
- **Estimated Diff:** ~120 lines.
- **Dependencies:** Task 5, Task 6.
- **External Acceptance Criteria:**
  - `POST /invitations/:token/accept` with valid pending token adds caller to `team_members`, marks invitation `ACCEPTED`, and returns HTTP 200.
  - Submitting an expired token returns HTTP 410 Gone.
  - Submitting an already accepted token returns HTTP 409 Conflict.
  - Database rollback verified: failure in creating member leaves invitation status `PENDING`.

#### Task 8: Invitation Revocation & Expiry Cleanup (`DELETE /teams/:id/invitations/:inviteId`)
- **Context Needed:** `api/src/teams/teams.controller.ts`, `api/src/teams/guards/team-role.guard.ts`
- **Expected Output:** Revocation endpoint and background expiry query utility in `teams.service.ts`.
- **Estimated Diff:** ~90 lines.
- **Dependencies:** Task 4, Task 6.
- **External Acceptance Criteria:**
  - `DELETE /teams/:id/invitations/:inviteId` called by Admin updates invitation status to `REVOKED` and returns HTTP 200.
  - Subsequent call to accept the revoked token returns HTTP 400 or 410.
  - Non-admin caller receives HTTP 403 Forbidden.

#### Task 9: Team-Scoped Resource Isolation (Tenant Isolation for Links)
- **Context Needed:** [schema.prisma](../../../api/prisma/schema.prisma), [links.service.ts](../../../api/src/links/links.service.ts), [links.controller.ts](../../../api/src/links/links.controller.ts)
- **Expected Output:** Add optional `teamId` relation to `Link` model; update `LinksService` queries to filter by `teamId` and verify active membership.
- **Estimated Diff:** ~110 lines.
- **Dependencies:** Task 1, Task 3, Task 4.
- **External Acceptance Criteria:**
  - Creating a link with `teamId` associates it with the team.
  - `GET /links?teamId=...` returns only links for that team to members; non-members receive HTTP 403 Forbidden.
  - Links created without `teamId` remain backward-compatible personal links.

---

## 3. Explicit Interface Contracts

### Contract 1: Task 1 $\rightarrow$ Task 2 & Task 4 (Prisma Schema to Domain Model)
```typescript
export enum TeamRole {
  OWNER = 'OWNER',
  ADMIN = 'ADMIN',
  MEMBER = 'MEMBER',
}

export interface TeamEntity {
  id: string; // UUID v4
  name: string; // VARCHAR(100)
  ownerId: string; // references users.id
  createdAt: Date;
  updatedAt: Date;
}

export interface TeamMemberEntity {
  id: string; // UUID v4
  teamId: string; // references teams.id
  userId: string; // references users.id
  role: TeamRole;
  joinedAt: Date;
}
```

### Contract 2: Task 4 $\rightarrow$ Tasks 6 & 8 (Authorization Decorator & Guard Context)
```typescript
// @Roles(TeamRole.ADMIN, TeamRole.OWNER)
// Evaluated by TeamRoleGuard extracting teamId from params/body/headers
export interface RequestWithTeamMember extends Request {
  user: { id: string; email: string };
  teamMember: {
    teamId: string;
    userId: string;
    role: TeamRole;
  };
}
```

### Contract 3: Task 5 $\rightarrow$ Tasks 6 & 7 (Invitation Token & Lifecycle State)
```typescript
export enum InvitationStatus {
  PENDING = 'PENDING',
  ACCEPTED = 'ACCEPTED',
  REVOKED = 'REVOKED',
  EXPIRED = 'EXPIRED',
}

export interface TeamInvitationEntity {
  id: string;
  teamId: string;
  email: string;
  role: TeamRole;
  tokenHash: string; // SHA-256 of raw 32-byte hex token sent via email
  status: InvitationStatus;
  invitedBy: string; // references users.id
  expiresAt: Date; // now + 7 days
  createdAt: Date;
}
```

---

## 4. The First Three Ready-to-Run Prompts

### Prompt 1 (Task 1: Team & Membership Prisma Schema Migration)
```text
Task: Add Team and TeamMember models and create a Prisma migration for the NestJS application.

Reference Files:
- api/prisma/schema.prisma (inspect existing Link and ClickEvent models for naming conventions, maps, and indexes)

Requirements:
1. Update api/prisma/schema.prisma:
   - Add enum TeamRole with values: OWNER, ADMIN, MEMBER.
   - Add model Team:
     - id: String @id @default(uuid())
     - name: String @db.VarChar(100)
     - ownerId: String @map("owner_id")
     - createdAt: DateTime @default(now()) @map("created_at")
     - updatedAt: DateTime @updatedAt @map("updated_at")
     - members: TeamMember[]
     - @@map("teams")
   - Add model TeamMember:
     - id: String @id @default(uuid())
     - teamId: String @map("team_id")
     - userId: String @map("user_id")
     - role: TeamRole @default(MEMBER)
     - joinedAt: DateTime @default(now()) @map("joined_at")
     - team: Team @relation(fields: [teamId], references: [id], onDelete: Cascade)
     - @@unique([teamId, userId])
     - @@index([userId])
     - @@map("team_members")
2. Run the migration generation command:
   cd api && npx prisma migrate dev --name create_teams_and_members
3. Verify client generation with npx prisma generate.

Negative Constraints:
- Do not install new npm dependencies.
- Do not modify existing Link or ClickEvent models in this step.
- Do not add mock data or seed scripts.
- Keep total changes in schema.prisma under 60 lines.
```

### Prompt 2 (Task 2: Team Module Foundation & Creation API `POST /teams`)
```text
Task: Implement the Teams NestJS module with POST /teams endpoint allowing authenticated users to create a team.

Reference Files:
- api/src/links/links.controller.ts (inspect standard controller patterns, decorators, and response codes)
- api/src/links/dto/create-link.dto.ts (inspect class-validator validation rules)
- api/src/auth/guards/jwt-auth.guard.ts (standard JWT guard)
- api/src/auth/decorators/current-user.decorator.ts (standard decorator to extract user id)
- api/src/prisma/prisma.service.ts (Prisma database client)

Requirements:
1. Create api/src/teams/dto/create-team.dto.ts:
   - name: string (IsString, IsNotEmpty, MaxLength(100))
2. Create api/src/teams/teams.service.ts:
   - Method createTeam(userId: string, dto: CreateTeamDto):
     - Uses prisma.$transaction to:
       1) Create team with name and ownerId: userId.
       2) Create initial team_members record with teamId, userId, and role: 'OWNER'.
       3) Return created team object.
3. Create api/src/teams/teams.controller.ts:
   - Protected by @UseGuards(JwtAuthGuard).
   - @Post() endpoint returning HTTP 201 with created team object.
4. Create api/src/teams/teams.module.ts and register it in api/src/app.module.ts.

Negative Constraints:
- Do not install new third-party packages.
- Total new lines of code across all 4 files must not exceed 130 lines.
- Follow NestJS standard dependency injection (PrismaService).
- Do not implement invitation logic or role checks in this task.
```

### Prompt 3 (Task 3: Team Retrieval & Member List Endpoints)
```text
Task: Implement GET /teams/:id and GET /teams/:id/members endpoints with team membership verification.

Reference Files:
- api/src/teams/teams.controller.ts (existing controller created in Task 2)
- api/src/teams/teams.service.ts (existing service created in Task 2)
- api/src/auth/decorators/current-user.decorator.ts (extract current user)
- api/src/auth/guards/jwt-auth.guard.ts (route authentication)

Requirements:
1. In api/src/teams/teams.service.ts:
   - Method getTeamById(teamId: string, userId: string):
     - Verify user is a member in team_members. If not, throw ForbiddenException('Not a member of this team').
     - If team does not exist, throw NotFoundException('Team not found').
     - Return team details and membership role.
   - Method getTeamMembers(teamId: string, userId: string):
     - Verify caller is an active member of teamId. If not, throw ForbiddenException.
     - Return array of team members: { userId, role, joinedAt }.
2. In api/src/teams/teams.controller.ts:
   - @Get(':id') -> calls getTeamById with param id and CurrentUser id. Returns HTTP 200.
   - @Get(':id/members') -> calls getTeamMembers with param id and CurrentUser id. Returns HTTP 200.

Negative Constraints:
- Do not modify files outside api/src/teams/.
- Do not install new dependencies.
- Changes must stay under 95 lines of code.
- Return explicit NestJS HTTP exceptions (ForbiddenException, NotFoundException).
```

