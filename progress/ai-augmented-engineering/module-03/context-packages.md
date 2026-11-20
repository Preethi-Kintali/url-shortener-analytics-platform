# Module 03 BUILD: Per-Task Context Packages & First-Pass Outputs

## Overview
This document contains the 3 per-task context packages built on top of the reusable [System-Level Context Document](../../system-context.md). 

### Workspace Verification & Grounding Notice:
- **Actual Inspected Codebase Files:** Files verified directly on disk in `api/` (`schema.prisma`, `links.controller.ts`, `links.service.ts`, `create-link.dto.ts`, `jwt-auth.guard.ts`, `current-principal.decorator.ts`, `all-exceptions.filter.ts`).
- **Upstream Planned Deliverables:** Files produced sequentially by earlier tasks (e.g., in Task 3, `teams.controller.ts` and `teams.service.ts` are outputs produced by Task 2, not pre-existing codebase files).
- **Principal Extraction:** Uses `@CurrentPrincipal() principalId: string` from [current-principal.decorator.ts](../../../api/src/auth/decorators/current-principal.decorator.ts).
- **Centralized Error Envelope:** Strictly follows `SafeErrorEnvelope` serialized by [all-exceptions.filter.ts](../../../api/src/common/filters/all-exceptions.filter.ts).

---

## Task Bundle 1: Team & Membership Prisma Schema Migration

### 1. Context Specification
- **Task Goal:** Add `Team`, `TeamMember`, and `TeamRole` models to Prisma schema and generate a migration.
- **Architectural Context Attached:** [progress/system-context.md](../../system-context.md)

#### Local Context — Actual Inspected Codebase Files (with Justifications):
1. [api/prisma/schema.prisma](../../../api/prisma/schema.prisma)
   - *Reason for Inclusion:* Shows existing data model patterns (`Link`, `ClickEvent`), UUID default generators (`@id @default(uuid())`), column mappings (`@map("created_at")`), relational cascading (`onDelete: Cascade`), and indexes (`@@index`).
   - *If Omitted:* The agent would guess table and column naming conventions, likely using camelCase columns in Postgres instead of snake_case mappings, or omitting cascade deletes.
2. `api/prisma/migrations/`
   - *Reason for Inclusion:* Confirms the Prisma migration directory structure and naming conventions (`YYYYMMDDHHMMSS_<migration_name>`).
   - *If Omitted:* The agent might generate raw SQL scripts in a non-standard directory or attempt to use an external migration runner like TypeORM or Knex.

#### Upstream Planned Deliverables:
- None (Task 1 is the root foundational task).

#### Files to Modify:
- [api/prisma/schema.prisma](../../../api/prisma/schema.prisma)

#### Expected Output:
- Modified `api/prisma/schema.prisma` containing `TeamRole` enum, `Team` model, and `TeamMember` model.
- Generated migration directory: `api/prisma/migrations/<timestamp>_create_teams_and_members/migration.sql`.

### 2. Assembled Prompt
```text
TASK: Add Team and TeamMember Prisma models and create a database migration.

SYSTEM CONTEXT:
Refer to progress/system-context.md for PostgreSQL snake_case column mapping, PrismaService conventions, and negative constraints.

LOCAL CONTEXT:
Read api/prisma/schema.prisma for model decorator conventions and existing uuid primary key generators.

TASK REQUIREMENTS:
1. In api/prisma/schema.prisma:
   - Define enum TeamRole with values: OWNER, ADMIN, MEMBER.
   - Define model Team: id (UUID), name (VarChar 100), ownerId (mapped to owner_id), createdAt (created_at), updatedAt (updated_at), members (relation to TeamMember[]). Table name mapped to "teams".
   - Define model TeamMember: id (UUID), teamId (mapped to team_id), userId (mapped to user_id), role (TeamRole, default MEMBER), joinedAt (joined_at), team (relation to Team with onDelete: Cascade). Unique constraint on [teamId, userId]. Table name mapped to "team_members".
2. Run migration: npx prisma migrate dev --name create_teams_and_members

NEGATIVE CONSTRAINTS:
- Do not modify Link or ClickEvent models.
- Do not add new npm packages.
- Keep schema changes strictly under 65 lines.
```

### 3. First-Pass Output
```prisma
enum TeamRole {
  OWNER
  ADMIN
  MEMBER
}

model Team {
  id        String       @id @default(uuid())
  name      String       @db.VarChar(100)
  ownerId   String       @map("owner_id")
  createdAt DateTime     @default(now()) @map("created_at")
  updatedAt DateTime     @updatedAt @map("updated_at")
  members   TeamMember[]

  @@map("teams")
}

model TeamMember {
  id       String   @id @default(uuid())
  teamId   String   @map("team_id")
  userId   String   @map("user_id")
  role     TeamRole @default(MEMBER)
  joinedAt DateTime @default(now()) @map("joined_at")

  team Team @relation(fields: [teamId], references: [id], onDelete: Cascade)

  @@unique([teamId, userId])
  @@index([userId])
  @@map("team_members")
}
```

---

## Task Bundle 2: Team Module Foundation & Creation API (`POST /teams`)

### 1. Context Specification
- **Task Goal:** Implement `POST /teams` endpoint, DTO validation, and atomic team creation in `TeamsService`.
- **Architectural Context Attached:** [progress/system-context.md](../../system-context.md)

#### Local Context — Actual Inspected Codebase Files (with Justifications):
1. [api/src/links/links.controller.ts](../../../api/src/links/links.controller.ts)
   - *Reason for Inclusion:* Demonstrates standard NestJS controller route declarations, `@UseGuards(JwtAuthGuard)`, `@Post()`, `@HttpCode()`, and DTO parameter binding.
   - *If Omitted:* The agent would guess route registration patterns, potentially using Express request objects directly or omitting JWT authentication guards.
2. [api/src/links/links.service.ts](../../../api/src/links/links.service.ts)
   - *Reason for Inclusion:* Demonstrates `PrismaService` dependency injection, transaction handling, and NestJS HTTP exception throwing.
   - *If Omitted:* The agent might create an independent Prisma client instance instead of using NestJS dependency injection, or return raw JSON error dictionaries.
3. [api/src/links/dto/create-link.dto.ts](../../../api/src/links/dto/create-link.dto.ts)
   - *Reason for Inclusion:* Demonstrates `class-validator` decorator patterns (`@IsString()`, `@IsNotEmpty()`, `@MaxLength()`).
   - *If Omitted:* The agent might use Joi, Zod, or manual `if (!name)` checks, breaking global `ValidationPipe` consistency.
4. [api/src/auth/decorators/current-principal.decorator.ts](../../../api/src/auth/decorators/current-principal.decorator.ts)
   - *Reason for Inclusion:* Demonstrates how to extract the authenticated user's ID (`@CurrentPrincipal() principalId: string`).
   - *If Omitted:* The agent would hallucinate a `@CurrentUser()` decorator or expect `req.user` directly from an imported Express Request object.
5. [api/src/common/filters/all-exceptions.filter.ts](../../../api/src/common/filters/all-exceptions.filter.ts)
   - *Reason for Inclusion:* Demonstrates the project's canonical `SafeErrorEnvelope` `{ error: { code, message, request_id } }` and illustrates how all thrown NestJS `HttpException` subclasses are centralized and serialized.
   - *If Omitted:* The agent risks inventing an ad-hoc error format like `{ "status": "error", "message": "..." }`, breaking frontend clients.

#### Upstream Planned Deliverables (from Task 1):
- `Team` and `TeamMember` Prisma models generated in `api/prisma/schema.prisma`.

#### Files to Modify:
- [api/src/app.module.ts](../../../api/src/app.module.ts) (register `TeamsModule`)

#### Expected Output:
- `api/src/teams/dto/create-team.dto.ts`
- `api/src/teams/teams.service.ts`
- `api/src/teams/teams.controller.ts`
- `api/src/teams/teams.module.ts`

### 2. Assembled Prompt (Corrected with Architectural Guardrails)
```text
TASK: Implement the Teams NestJS module with POST /teams endpoint for authenticated team creation.

SYSTEM CONTEXT:
Refer to progress/system-context.md for NestJS conventions, DTO validation, SafeErrorEnvelope conventions, and transactional safety.

LOCAL CONTEXT:
- Read api/src/links/links.controller.ts for controller and guard patterns.
- Read api/src/links/links.service.ts for PrismaService injection and transaction patterns.
- Read api/src/links/dto/create-link.dto.ts for class-validator DTO patterns.
- Read api/src/auth/decorators/current-principal.decorator.ts for extracting authenticated principalId.
- Read api/src/common/filters/all-exceptions.filter.ts for SafeErrorEnvelope contract.
- Reference Task 1 Prisma Schema: models Team and TeamMember.

TASK REQUIREMENTS:
1. Create api/src/teams/dto/create-team.dto.ts with validated name (IsString, IsNotEmpty, MaxLength(100)).
2. Create api/src/teams/teams.service.ts with createTeam(principalId: string, dto: CreateTeamDto):
   - Wrap in prisma.$transaction to create team and initial team_members record with role: 'OWNER'.
   - Throw BadRequestException if team name is blank.
3. Create api/src/teams/teams.controller.ts:
   - Protected by @UseGuards(JwtAuthGuard).
   - @Post() endpoint taking @Body() dto: CreateTeamDto and @CurrentPrincipal() principalId: string, returning HTTP 201 with created team object.
4. Create api/src/teams/teams.module.ts and register in api/src/app.module.ts.

NEGATIVE CONSTRAINTS:
- No new third-party packages.
- Total new lines across all files <= 125 lines.
- Do NOT manually format or return custom error JSON (e.g. { status: 'error', message: '...' }). Always throw standard NestJS built-in HTTP exceptions (BadRequestException, NotFoundException, etc.). Centralized AllExceptionsFilter automatically serializes them into SafeErrorEnvelope with request_id.
```

### 3. First-Pass Output (Convention-Compliant)
```typescript
// api/src/teams/dto/create-team.dto.ts
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateTeamDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;
}

// api/src/teams/teams.service.ts
import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTeamDto } from './dto/create-team.dto';

@Injectable()
export class TeamsService {
  constructor(private readonly prisma: PrismaService) {}

  async createTeam(principalId: string, dto: CreateTeamDto) {
    if (!dto.name?.trim()) {
      throw new BadRequestException('Team name is required');
    }

    return this.prisma.$transaction(async (tx) => {
      const team = await tx.team.create({
        data: {
          name: dto.name.trim(),
          ownerId: principalId,
        },
      });

      await tx.teamMember.create({
        data: {
          teamId: team.id,
          userId: principalId,
          role: 'OWNER',
        },
      });

      return team;
    });
  }
}

// api/src/teams/teams.controller.ts
import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentPrincipal } from '../auth/decorators/current-principal.decorator';
import { TeamsService } from './teams.service';
import { CreateTeamDto } from './dto/create-team.dto';

@Controller('teams')
@UseGuards(JwtAuthGuard)
export class TeamsController {
  constructor(private readonly teamsService: TeamsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createTeam(
    @Body() dto: CreateTeamDto,
    @CurrentPrincipal() principalId: string,
  ) {
    return this.teamsService.createTeam(principalId, dto);
  }
}
```

---

## Task Bundle 3: Team Retrieval & Member List Endpoints

### 1. Context Specification
- **Task Goal:** Implement `GET /teams/:id` and `GET /teams/:id/members` with team membership access control.
- **Architectural Context Attached:** [progress/system-context.md](../../system-context.md)

#### Local Context — Actual Inspected Codebase Files (with Justifications):
1. [api/src/links/links.controller.ts](../../../api/src/links/links.controller.ts)
   - *Reason for Inclusion:* Demonstrates route parameter extraction (`@Param('id')`), `@Get()` routes, and `@CurrentPrincipal()`.
   - *If Omitted:* The agent would guess parameter extraction methods or use Express Request directly.
2. [api/src/links/links.service.ts](../../../api/src/links/links.service.ts)
   - *Reason for Inclusion:* Shows how queries check owner/member permissions and throw `NotFoundException` and `ForbiddenException`.
   - *If Omitted:* The agent would return `null` or raw `400` status codes instead of `403` / `404`.
3. [api/src/auth/decorators/current-principal.decorator.ts](../../../api/src/auth/decorators/current-principal.decorator.ts)
   - *Reason for Inclusion:* Standard decorator for principal ID injection.
   - *If Omitted:* The agent would hallucinate `@CurrentUser()`.
4. [api/src/common/filters/all-exceptions.filter.ts](../../../api/src/common/filters/all-exceptions.filter.ts)
   - *Reason for Inclusion:* Demonstrates that throwing `NotFoundException` and `ForbiddenException` results in `NOT_FOUND` and `FORBIDDEN` envelope codes with `request_id`.
   - *If Omitted:* The agent might catch errors and return manual JSON payloads.

#### Upstream Planned Deliverables (from Task 2):
*Note: These files do not currently exist in the starter workspace on disk; they are the planned deliverables produced by Task 2 immediately prior in the sequential dependency plan:*
- `api/src/teams/teams.controller.ts` (Target file to extend with `@Get(':id')` and `@Get(':id/members')`).
- `api/src/teams/teams.service.ts` (Target file to extend with `getTeamById` and `getTeamMembers`).

#### Files to Modify:
- `api/src/teams/teams.controller.ts` (extended)
- `api/src/teams/teams.service.ts` (extended)

#### Expected Output:
- Updated `teams.controller.ts` and `teams.service.ts` with `getTeamById` and `getTeamMembers` methods.

### 2. Assembled Prompt (Corrected with Architectural Guardrails)
```text
TASK: Implement GET /teams/:id and GET /teams/:id/members with membership authorization.

SYSTEM CONTEXT:
Refer to progress/system-context.md for exception handling, SafeErrorEnvelope contract, and NestJS controller patterns.

LOCAL CONTEXT:
- Read api/src/links/links.controller.ts and api/src/links/links.service.ts for exception and route patterns.
- Read api/src/auth/decorators/current-principal.decorator.ts for principal extraction.
- Read api/src/common/filters/all-exceptions.filter.ts for error code mapping.
- Upstream Task Deliverables: Extend api/src/teams/teams.controller.ts and api/src/teams/teams.service.ts produced in Task 2.

TASK REQUIREMENTS:
1. In TeamsService:
   - getTeamById(teamId: string, principalId: string):
     - Check team exists; if not, throw NotFoundException('Team not found').
     - Check membership in team_members; if not, throw ForbiddenException('Not a member of this team').
     - Return team object.
   - getTeamMembers(teamId: string, principalId: string):
     - Check membership; if not, throw ForbiddenException('Not a member of this team').
     - Return array of { userId, role, joinedAt }.
2. In TeamsController:
   - @Get(':id') -> getTeamById(id, principalId)
   - @Get(':id/members') -> getTeamMembers(id, principalId)

NEGATIVE CONSTRAINTS:
- Do not modify files outside api/src/teams/.
- Diff <= 90 lines.
- Do NOT construct or return manual JSON error payloads (e.g. { status: 'error' }). Always throw standard NestJS built-in HTTP exceptions. AllExceptionsFilter centrally produces SafeErrorEnvelope.
```

### 3. First-Pass Output (Convention-Compliant)
```typescript
// Additions to api/src/teams/teams.service.ts
async getTeamById(teamId: string, principalId: string) {
  const team = await this.prisma.team.findUnique({
    where: { id: teamId },
    include: {
      members: {
        where: { userId: principalId },
      },
    },
  });

  if (!team) {
    throw new NotFoundException('Team not found');
  }

  if (!team.members || team.members.length === 0) {
    throw new ForbiddenException('Not a member of this team');
  }

  return {
    id: team.id,
    name: team.name,
    ownerId: team.ownerId,
    createdAt: team.createdAt,
    updatedAt: team.updatedAt,
    userRole: team.members[0].role,
  };
}

async getTeamMembers(teamId: string, principalId: string) {
  const membership = await this.prisma.teamMember.findUnique({
    where: {
      teamId_userId: {
        teamId,
        userId: principalId,
      },
    },
  });

  if (!membership) {
    throw new ForbiddenException('Not a member of this team');
  }

  return this.prisma.teamMember.findMany({
    where: { teamId },
    select: {
      userId: true,
      role: true,
      joinedAt: true,
    },
    orderBy: { joinedAt: 'asc' },
  });
}

// Additions to api/src/teams/teams.controller.ts
@Get(':id')
async getTeamById(
  @Param('id') id: string,
  @CurrentPrincipal() principalId: string,
) {
  return this.teamsService.getTeamById(id, principalId);
}

@Get(':id/members')
async getTeamMembers(
  @Param('id') id: string,
  @CurrentPrincipal() principalId: string,
) {
  return this.teamsService.getTeamMembers(id, principalId);
}
```

---

## 4. Key Takeaways & Context Impact
- **Grounding Fidelity:** Using the actual inspected `@CurrentPrincipal()` decorator and referencing existing NestJS controller/service patterns eliminates hallucinated decorator imports.
- **Dependency Distinction:** Explicitly distinguishing upstream task deliverables from actual inspected codebase files prevents false assumptions about files existing before they are built.
- **Context Economy & Negative Constraints:** Adding the explicit `SafeErrorEnvelope` interface and negative constraints against ad-hoc error formatting guarantees 100% adherence to project conventions without increasing prompt token bloat.
