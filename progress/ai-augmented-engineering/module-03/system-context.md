# System-Level Context Document: TaskFlow & URL Shortener Platform

This reusable system-level context document defines the overarching architecture, coding conventions, and negative constraints governing all engineering tasks. It must be attached as the base architectural context layer for every prompt.

---

## 1. Architecture Summary

- **Runtime & Framework:** Node.js (v20+) with NestJS 10.x (`@nestjs/core`, `@nestjs/common`, `@nestjs/platform-express`).
- **Module Architecture:** Feature-sliced modular structure under `api/src/`:
  - Each domain feature resides in its own directory: `api/src/<feature>/` (e.g., `links/`, `auth/`, `analytics/`, and `teams/`).
  - Feature module imports `PrismaModule` (`api/src/prisma/prisma.module.ts`) and declares its controllers, services, and DTOs.
  - All feature modules are registered in the root container: `api/src/app.module.ts`.
- **Database & Persistence:**
  - PostgreSQL 16 managed via Prisma ORM (`@prisma/client`, `prisma`).
  - Single injected database service: `PrismaService` (`api/src/prisma/prisma.service.ts`).
  - Database migrations are strictly managed through Prisma CLI (`api/prisma/migrations/`).
- **Caching & Background Queues:**
  - Redis 7 (`ioredis`) for high-speed caching (`api/src/cache/cache.service.ts`).
  - BullMQ (`bullmq`) for asynchronous click-event processing and workers (`api/src/analytics/`).
- **Middleware & Pipeline:**
  - Global `ValidationPipe` with `{ whitelist: true, forbidNonWhitelisted: true, transform: true }`.
  - Request ID tracking middleware: `api/src/common/middleware/request-id.middleware.ts`.
  - Structured JSON logging: `api/src/common/logging/structured-logger.service.ts`.
  - Global exception filter: `api/src/common/filters/all-exceptions.filter.ts` registered as `APP_FILTER` in `AppModule`.

---

## 2. Coding & Implementation Conventions

### File & Directory Naming
- Directory names: `kebab-case` (e.g., `links/`, `auth/`, `common/`).
- TypeScript files: `kebab-case.<role>.ts`:
  - Controllers: `<name>.controller.ts`
  - Services: `<name>.service.ts`
  - Modules: `<name>.module.ts`
  - DTOs: `<action>-<entity>.dto.ts` (stored in `dto/` subdirectory)
  - Guards: `<name>.guard.ts` (stored in `guards/` subdirectory)
  - Decorators: `<name>.decorator.ts` (stored in `decorators/` subdirectory)

### Code Identifier Naming
- Classes: `PascalCase` (e.g., `TeamsController`, `CreateTeamDto`, `PrismaService`).
- Methods & Variables: `camelCase` (e.g., `createTeam`, `teamMember`, `expiresAt`, `principalId`).
- Database Tables & Columns: Database identifiers in PostgreSQL must be `snake_case` mapped via Prisma `@map("...")` and `@@map("...")` (e.g., `owner_id`, `created_at`, `team_members`).

### Input Validation Pattern
- Every HTTP mutation endpoint must accept a strongly-typed DTO class using `class-validator` and `class-transformer`:
  ```typescript
  import { IsString, IsNotEmpty, MaxLength } from 'class-validator';

  export class CreateTeamDto {
    @IsString()
    @IsNotEmpty()
    @MaxLength(100)
    name: string;
  }
  ```

### Authentication & Authorization Pattern
- Authentication Guard: Protected routes apply `@UseGuards(JwtAuthGuard)` (`api/src/auth/guards/jwt-auth.guard.ts`).
- Authenticated Principal Extraction: Handlers extract the calling user's string identifier using the custom parameter decorator `@CurrentPrincipal()` (`api/src/auth/decorators/current-principal.decorator.ts`), returning `principalId: string`.
- Route Access Control: Custom guards (`TeamRoleGuard`) resolve team membership from `team_members` and evaluate against `@Roles(...)` metadata.

### Standardized Error Handling Convention & SafeErrorEnvelope

#### The Canonical API Error Envelope:
All errors returned by the HTTP API must strictly adhere to `SafeErrorEnvelope` defined in [api/src/common/filters/all-exceptions.filter.ts](../../../api/src/common/filters/all-exceptions.filter.ts#L36-L42):

```typescript
export interface SafeErrorEnvelope {
  error: {
    code: string;       // Machine-readable enum (e.g., 'VALIDATION_ERROR', 'FORBIDDEN')
    message: string;    // Human-readable message
    request_id: string; // Distributed trace ID matching X-Request-Id header (e.g., 'req_...')
  };
}
```

#### Architectural Rule: Throw, Never Manually Format
- **Controllers and Services:** Must **NEVER** construct custom error JSON responses or return `{ status: 'error', ... }`.
- **Exception Throwing:** Always throw built-in NestJS `HttpException` subclasses:
  - `BadRequestException` (HTTP 400) -> Serialized as `"code": "VALIDATION_ERROR"`
  - `UnauthorizedException` (HTTP 401) -> Serialized as `"code": "UNAUTHORIZED"`
  - `ForbiddenException` (HTTP 403) -> Serialized as `"code": "FORBIDDEN"`
  - `NotFoundException` (HTTP 404) -> Serialized as `"code": "NOT_FOUND"`
  - `ConflictException` (HTTP 409) -> Serialized as `"code": "CONFLICT"`
  - `GoneException` (HTTP 410) -> Serialized as `"code": "GONE"`
- **Centralized Serialization:** The globally registered `AllExceptionsFilter` (`APP_FILTER` in `AppModule`) intercepts all thrown exceptions, resolves `request_id`, redacts sensitive text, logs structured events, and serializes the HTTP response body into `SafeErrorEnvelope`.

#### Concrete Anti-Pattern vs. Correct Pattern:

```typescript
// ❌ INCORRECT (Anti-pattern: Ad-hoc error formatting breaks client contract)
@Post()
async createTeam(@Body() dto: CreateTeamDto, @Res() res: Response) {
  if (!dto.name) {
    return res.status(400).json({
      status: 'error',
      message: 'Team name is required.',
      statusCode: 400,
    });
  }
}

// ✅ CORRECT (Canonical NestJS pattern: Centralized exception filter serialization)
@Post()
@HttpCode(HttpStatus.CREATED)
async createTeam(
  @Body() dto: CreateTeamDto,
  @CurrentPrincipal() principalId: string,
) {
  return this.teamsService.createTeam(principalId, dto);
}

// In TeamsService:
if (!dto.name?.trim()) {
  throw new BadRequestException('Team name is required.');
}
// -> Filter automatically produces:
// HTTP 400
// {
//   "error": {
//     "code": "VALIDATION_ERROR",
//     "message": "Team name is required.",
//     "request_id": "req_8e4a91c2b53f"
//   }
// }
```

---

## 3. Universal Constraints ("Must-Nots")

1. **Zero New Dependencies:** Do not add third-party packages to `package.json`. Use built-in Node.js modules (e.g., `crypto` for hashing and random tokens) and existing project libraries.
2. **Reuse Existing Guards & Decorators:** Must use `JwtAuthGuard` from `api/src/auth/guards/jwt-auth.guard.ts` and `@CurrentPrincipal()` from `api/src/auth/decorators/current-principal.decorator.ts`.
3. **Transactional Safety:** Any multi-table mutation (e.g., team creation + owner membership, or invitation acceptance + member insertion) must be wrapped in `prisma.$transaction`.
4. **No Raw SQL:** Use Prisma Client typed query methods (`this.prisma.team.create(...)`). Do not use `$queryRaw` without explicit architectural approval.
5. **Diff Boundary:** Every individual task must produce $\le 150$ lines of code changes.
6. **Zero Ad-Hoc Error Formats:** Do NOT construct or return custom error JSON dictionaries (such as `{ status: "error" }`). Always throw NestJS `HttpException` subclasses and let `AllExceptionsFilter` serialize into `SafeErrorEnvelope`.
