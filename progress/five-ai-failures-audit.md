# Module 04 Forensic Review: The Five Things AI Always Gets Wrong

## Executive Summary & Review Scope

This document provides a senior peer-level forensic audit of an AI-generated endpoint implementation (`POST /teams/:teamId/invitations`) and its accompanying Jest test suite. 

The audited code represents a classic archetype of AI-generated code: **syntactically clean and functional on the happy path, but riddled with systemic security vulnerabilities, unhandled edge cases, brittle error handling, smeared abstractions, and illusory test coverage**.

This static analysis inspects the supplied code line-by-line across all five systematic AI failure categories, identifying exact defects, realistic failure modes, recommended architectural corrections, and detection test specifications.

---

## The Audited Code Under Review

```javascript
// POST /teams/:teamId/invitations
async function createInvitation(req, res) {
  try {
    const { teamId } = req.params;
    const { email } = req.body;

    // Check if user is authenticated
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // Look up the team
    const team = await db.query(
      `SELECT * FROM teams WHERE id = '${teamId}'`
    );

    if (!team) {
      return res.status(404).json({ error: "Not found" });
    }

    // Create invitation
    const invitation = await db.query(
      `INSERT INTO invitations (team_id, email, invited_by, status)
       VALUES ('${teamId}', '${email}', '${req.user.id}', 'pending')
       RETURNING *`
    );

    // Send email
    await emailService.send(email, "You've been invited!", {
      teamName: team.name,
      invitedBy: req.user.email,
    });

    console.log(`Invitation sent: user=${req.user.email}, team=${teamId}, invitee=${email}`);

    res.status(201).json({ data: invitation });
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "Something went wrong" });
  }
}

// Test
describe("createInvitation", () => {
  it("should create an invitation", async () => {
    const mockDb = { query: jest.fn().mockResolvedValue({ id: 1, name: "Team A" }) };
    const mockEmail = { send: jest.fn().mockResolvedValue(true) };

    const req = {
      user: { id: 1, email: "admin@test.com" },
      params: { teamId: "1" },
      body: { email: "invitee@test.com" },
    };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

    await createInvitation(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
  });
});
```

---

## 1. Security (Severity: Critical)

### Finding 1.1: Direct SQL Injection in Template Literals
- **Problematic Code:**
  ```javascript
  const team = await db.query(`SELECT * FROM teams WHERE id = '${teamId}'`);
  // and
  const invitation = await db.query(
    `INSERT INTO invitations (team_id, email, invited_by, status)
     VALUES ('${teamId}', '${email}', '${req.user.id}', 'pending')
     RETURNING *`
  );
  ```
- **Failure Category:** Security — SQL Injection (CWE-89).
- **Severity:** **CRITICAL** (CVSS 9.8).
- **Why It Is a Defect:** Dynamic string interpolation directly embeds untrusted client input (`teamId` from URL parameters and `email` from request JSON body) into raw SQL statements without escaping, sanitization, or query parameterization.
- **Realistic Failure Scenario:** An attacker authenticates and sends a POST request with `email`:
  `victim@example.com', 'admin_id', 'pending'); DROP TABLE teams; --`
  The database executes the insertion and immediately truncates or drops critical relational tables. An attacker could also use stacked queries or `UNION SELECT` to dump password hashes and authentication tokens.
- **Recommended Correction:** Replace raw string interpolation with parameterized queries (`$1, $2, $3`) or use a type-safe ORM like Prisma:
  ```typescript
  // In PrismaService:
  const team = await this.prisma.team.findUnique({ where: { id: teamId } });
  const invitation = await this.prisma.teamInvitation.create({
    data: { teamId, email, invitedBy: req.user.id, status: 'PENDING' },
  });
  ```
- **Detection Test:** Send payload with `email: "' OR '1'='1"`. Assert that the query engine rejects the syntax or treats it strictly as a literal email string, never executing SQL commands.

---

### Finding 1.2: Broken Object-Level Authorization (IDOR)
- **Problematic Code:**
  ```javascript
  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  // Immediately queries team by teamId without checking user's team membership or role
  ```
- **Failure Category:** Security — Insecure Direct Object Reference (IDOR / CWE-639 / OWASP API1:2023).
- **Severity:** **CRITICAL**.
- **Why It Is a Defect:** The function conflates **authentication** (verifying that `req.user` exists) with **authorization** (verifying that `req.user` holds the permission to invite users to `teamId`). Any authenticated user in the system can issue invitations to *any* team simply by swapping the `teamId` in the URL.
- **Realistic Failure Scenario:** User Attacker (User ID 500) authenticates to the platform. They issue `POST /teams/team-corp-executive/invitations` with their personal email address. Because the code does not verify whether User 500 is an owner or admin of `team-corp-executive`, the invitation is issued and sent, allowing unauthorized lateral movement into a private enterprise team.
- **Recommended Correction:** Enforce a strict authorization guard or query `team_members` to verify that `req.user.id` is an active member with `OWNER` or `ADMIN` role for the specified `teamId`:
  ```typescript
  const membership = await this.prisma.teamMember.findUnique({
    where: { teamId_userId: { teamId, userId: principalId } },
  });
  if (!membership || !['OWNER', 'ADMIN'].includes(membership.role)) {
    throw new ForbiddenException('You do not have permission to invite members to this team');
  }
  ```
- **Detection Test:** Authenticate as User A (who is not a member of Team B). Issue `POST /teams/TeamB/invitations`. Assert that the endpoint returns `HTTP 403 Forbidden` (`FORBIDDEN`).

---

### Finding 1.3: Plaintext PII Exposure in Unstructured Server Logs
- **Problematic Code:**
  ```javascript
  console.log(`Invitation sent: user=${req.user.email}, team=${teamId}, invitee=${email}`);
  ```
- **Failure Category:** Security — Sensitive Data Exposure in Logs (CWE-532 / GDPR / CCPA).
- **Severity:** **MEDIUM / HIGH**.
- **Why It Is a Defect:** Outputs raw personal identifiable information (PII) including inviter email, invitee email, and team relationships to standard out in unredacted plaintext. Server logs are frequently ingested by third-party aggregators, cached in unencrypted files, and made visible to broad engineering staff without compliance access controls.
- **Realistic Failure Scenario:** Log files streamed to Datadog, CloudWatch, or Grafana Loki allow unauthorized developers or compromised log-reader tokens to harvest user email directories and organizational team structures.
- **Recommended Correction:** Use the project's centralized `StructuredLoggerService` with automated sensitive text redaction:
  ```typescript
  this.logger.log({
    event: 'invitation_created',
    team_id: teamId,
    invited_by: req.user.id,
    invitee_hash: hashEmail(email),
  }, 'InvitationsService');
  ```
- **Detection Test:** Execute the invitation endpoint in a test environment with a log-capture spy; assert that raw email addresses do not appear in log strings.

---

## 2. Edge Cases (Severity: High)

### Finding 2.1: Missing Email Input Validation
- **Problematic Code:**
  ```javascript
  const { email } = req.body;
  // Passed straight to SQL query and emailService
  ```
- **Failure Category:** Edge Cases — Unvalidated Input.
- **Severity:** **HIGH**.
- **Why It Is a Defect:** The endpoint does not perform type checking, format validation, whitespace trimming, or length constraints. It accepts `null`, `undefined`, empty string `""`, non-string values (`{ email: 12345 }`), Unicode junk, or 50,000-character payload attacks.
- **Realistic Failure Scenario:** A malformed client sends `{ email: "   " }`. The database successfully inserts a record with a whitespace email. The downstream `emailService.send()` throws an unhandled exception or attempts to dispatch to an invalid address, leaving garbage data in the database.
- **Recommended Correction:** Enforce DTO validation with `class-validator` and `class-transformer`:
  ```typescript
  export class CreateInvitationDto {
    @IsEmail()
    @IsNotEmpty()
    @MaxLength(255)
    @Transform(({ value }) => value?.trim().toLowerCase())
    email: string;
  }
  ```
- **Detection Test:** Submit requests with `email: ""`, `email: null`, `email: "notanemail"`, and `email: "a".repeat(500) + "@test.com"`. Assert `HTTP 400 Bad Request` (`VALIDATION_ERROR`).

---

### Finding 2.2: Duplicate Invitations & Existing Team Membership Conflicts
- **Problematic Code:**
  ```javascript
  const invitation = await db.query(
    `INSERT INTO invitations (team_id, email, invited_by, status)
     VALUES ('${teamId}', '${email}', '${req.user.id}', 'pending')
     RETURNING *`
  );
  ```
- **Failure Category:** Edge Cases — Unhandled State Collisions.
- **Severity:** **HIGH**.
- **Why It Is a Defect:** Does not check whether the invited user is **already an active member** of the team, or whether an invitation is **already pending** for that email address.
- **Realistic Failure Scenario:** 
  1. An admin invites `alice@example.com`. Alice is already the team Owner. Creating an invitation is nonsensical.
  2. An impatient admin clicks the "Invite" button five times in rapid succession, resulting in 5 duplicate pending invitation tokens for the same user, causing confusion during token redemption.
- **Recommended Correction:** 
  1. Look up existing team membership by email/userId.
  2. Look up existing pending invitations for `(teamId, email)`.
  3. Enforce a database-level unique constraint on `(team_id, email)` for pending invitations.
  ```typescript
  if (isExistingMember) throw new ConflictException('User is already a member of this team');
  if (hasPendingInvitation) throw new ConflictException('An active invitation is already pending for this email');
  ```
- **Detection Test:** Send two consecutive invitation requests for the same email to the same team. Assert the first returns `HTTP 201 Created` and the second returns `HTTP 409 Conflict` (`CONFLICT`).

---

### Finding 2.3: Self-Invitation Policy (Policy Ambiguity vs Defect)
- **Problematic Code:** The code does not check if `req.user.email === email`.
- **Failure Category:** Edge Cases — Policy Boundary.
- **Severity:** **LOW / MEDIUM**.
- **Why It Is a Defect/Concern:** Allowing an administrator to invite their own email address is at best redundant and at worst a privilege escalation vector if pending invitations can overwrite existing roles.
- **Architectural Policy Clarification Required:** The engineering team must clarify whether self-invitation is prohibited (`400 Bad Request`) or ignored.
- **Recommended Correction:** Add business validation:
  ```typescript
  if (req.user.email.toLowerCase() === dto.email.toLowerCase()) {
    throw new BadRequestException('You cannot invite yourself to a team you are already managing');
  }
  ```
- **Detection Test:** Attempt to invite `req.user.email`. Assert `HTTP 400 Bad Request`.

---

### Finding 2.4: Team ID Format & Identifier Schema Validation
- **Problematic Code:**
  ```javascript
  const { teamId } = req.params;
  ```
- **Failure Category:** Edge Cases — Type & Format Validation.
- **Severity:** **MEDIUM**.
- **Why It Is a Defect:** The route assumes `teamId` is valid. In production PostgreSQL databases using UUID primary keys (`@id @default(uuid())`), passing a non-UUID string like `"abc"` or `"team_1"` causes Postgres to crash the query with `invalid input syntax for type uuid: "abc"` (Prisma error `P2025` or database driver syntax error), bubbling up as an unexpected 500 server error instead of a clean 400 client validation error.
- **Recommended Correction:** Validate route parameters using NestJS pipes:
  ```typescript
  @Param('teamId', ParseUUIDPipe) teamId: string
  ```
- **Detection Test:** Send `POST /teams/not-a-uuid/invitations`. Assert `HTTP 400 Bad Request` without querying the database.

---

### Finding 2.5: Concurrency Race Conditions
- **Problematic Code:** Unsynchronized read-then-write sequence without database-level constraints.
- **Failure Category:** Edge Cases — Concurrency / Race Condition.
- **Severity:** **HIGH**.
- **Why It Is a Defect:** If two requests for the same email arrive concurrently on different worker threads, both will execute `SELECT`, observe no existing invitation, and both execute `INSERT`, resulting in duplicate active invitations.
- **Recommended Correction:** Ensure the database schema has a partial unique index:
  ```sql
  CREATE UNIQUE INDEX unique_active_invitation ON invitations (team_id, email) WHERE status = 'pending';
  ```
- **Detection Test:** Fire 10 parallel asynchronous requests for the same email; assert exactly 1 succeeds with HTTP 201 and 9 fail with HTTP 409 Conflict.

---

## 3. Error Handling (Severity: Medium / High)

### Finding 3.1: Swallowed Exceptions & Uninformative Error Responses
- **Problematic Code:**
  ```javascript
  catch (err) {
    console.log(err);
    res.status(500).json({ error: "Something went wrong" });
  }
  ```
- **Failure Category:** Error Handling — Exception Swallowing.
- **Severity:** **MEDIUM**.
- **Why It Is a Defect:** Catches all runtime errors indiscriminately, dumps them to `console.log`, and returns a generic `500 Something went wrong`.
  - Client callers cannot distinguish between invalid input (400), unauthorized actions (403), resource collisions (409), and actual infrastructure failures (500).
  - Bypasses standardized API envelopes.
- **Recommended Correction:** Remove manual `try/catch` JSON formatting. Allow NestJS HTTP exceptions to bubble up to the globally registered `AllExceptionsFilter`, which automatically formats `SafeErrorEnvelope` `{ error: { code, message, request_id } }`.
- **Detection Test:** Induce a database constraint error; assert the response status is 409 (not 500) and contains the `SafeErrorEnvelope` structure with an `X-Request-Id`.

---

### Finding 3.2: Non-Atomic Side Effects (Dual-Write Delivery Hazard)
- **Problematic Code:**
  ```javascript
  // Step 1: Write to DB
  const invitation = await db.query(`INSERT INTO invitations ...`);

  // Step 2: Send external email
  await emailService.send(email, "You've been invited!", { ... });
  ```
- **Failure Category:** Error Handling — Inconsistent Distributed State / Dual-Write Problem.
- **Severity:** **HIGH**.
- **Why It Is a Defect:** The database insert and email dispatch are executed sequentially without compensation or transactional boundaries.
  - If `emailService.send()` throws an error (e.g. SMTP timeout, SendGrid rate limit), the function enters `catch (err)` and returns `HTTP 500`.
  - **However, the invitation has ALREADY been committed to the database.**
  - The recipient never receives the email, but the database now marks them as "pending". When the admin retries, the system reports a collision or duplicate error.
- **Architectural Critical Insight: Why a Database Transaction Alone Cannot Fix This:**
  A database transaction (`BEGIN ... COMMIT`) **cannot roll back an external network side-effect**!
  - If email dispatch is placed inside the DB transaction before commit, and the subsequent DB commit fails, the user receives an email containing a link to an invitation record that does not exist in the database!
  - If email dispatch is placed after the DB commit, and email fails, the database holds a phantom record.
- **Recommended Correction:** Implement the **Transactional Outbox Pattern** or an asynchronous message queue (e.g., BullMQ / Redis):
  1. Wrap the invitation creation and an `OutboxMessage` record in an atomic `prisma.$transaction`.
  2. Commit the database transaction immediately.
  3. A reliable background worker processes the outbox queue, dispatches the email with retries, exponential backoff, and dead-letter queues.
- **Detection Test:** Mock `emailService.send` to throw an error (`ServiceUnavailableException`). Call the endpoint. Verify that no orphaned, un-retried pending invitation remains in the database.

---

### Finding 3.3: Inconsistent Error Payload Structure
- **Problematic Code:**
  ```javascript
  return res.status(401).json({ error: "Unauthorized" });
  return res.status(404).json({ error: "Not found" });
  res.status(500).json({ error: "Something went wrong" });
  ```
- **Failure Category:** Error Handling — Contract Inconsistency.
- **Severity:** **MEDIUM**.
- **Why It Is a Defect:** Violates the canonical `SafeErrorEnvelope` contract established in `api/src/common/filters/all-exceptions.filter.ts`:
  ```typescript
  export interface SafeErrorEnvelope {
    error: {
      code: string;
      message: string;
      request_id: string;
    };
  }
  ```
  Client applications expecting `error.code` and `error.request_id` will encounter undefined values.
- **Recommended Correction:** Throw built-in NestJS exceptions (`throw new UnauthorizedException()`, `throw new NotFoundException()`) and let `AllExceptionsFilter` format the response.
- **Detection Test:** Call route without credentials; assert response matches `{ error: { code: "UNAUTHORIZED", message: "...", request_id: "req_..." } }`.

---

## 4. Naming & Abstractions (Severity: Medium)

### Finding 4.1: God Function & Smeared Architectural Layers
- **Problematic Code:** The entire `createInvitation` function combines HTTP parameter extraction, authentication checking, SQL querying, external email dispatch, logging, and response formatting in a single 35-line block.
- **Failure Category:** Naming & Abstractions — Violating Single Responsibility Principle (SRP).
- **Severity:** **MEDIUM**.
- **Why It Is a Defect:** Makes unit testing nearly impossible without heavy end-to-end mocking. Mixes transport concerns (Express `req`/`res`) with business logic and persistence concerns.
- **Recommended Correction:** Separate responsibilities according to NestJS modular architecture:
  - `InvitationsController`: Routes, guards, parameter binding, DTO validation.
  - `InvitationsService`: Business logic, team authorization, conflict checks.
  - `PrismaService`: Database queries and transactions.
  - `MailQueueService`: Outbox email queuing.
- **Detection Test:** Verify that `InvitationsController` can be tested with a mocked `InvitationsService` without referencing database drivers or email APIs.

---

### Finding 4.2: Over-fetching with `SELECT *`
- **Problematic Code:**
  ```javascript
  const team = await db.query(`SELECT * FROM teams WHERE id = '${teamId}'`);
  // Only team.name is used later:
  teamName: team.name
  ```
- **Failure Category:** Naming & Abstractions — Database Over-fetching.
- **Severity:** **LOW / MEDIUM**.
- **Why It Is a Defect:** Queries and buffers every column from the `teams` table into memory across the network, despite only reading `team.name`. If `teams` contains sensitive settings, audit blobs, or billing tokens, they are loaded unnecessarily.
- **Recommended Correction:** Use explicit projections:
  ```typescript
  const team = await this.prisma.team.findUnique({
    where: { id: teamId },
    select: { name: true },
  });
  ```
- **Detection Test:** Assert query execution log confirms only the `name` column is selected.

---

### Finding 4.3: Leaking Raw Database Entities Across the API Boundary
- **Problematic Code:**
  ```javascript
  const invitation = await db.query(`INSERT ... RETURNING *`);
  res.status(201).json({ data: invitation });
  ```
- **Failure Category:** Naming & Abstractions — Leaky Abstraction / Domain Decoupling.
- **Severity:** **MEDIUM**.
- **Why It Is a Defect:** Directly serializes the raw relational database record (`RETURNING *`) to the external HTTP response. If the `invitations` table includes internal primary key IDs, token hashes, or database-specific timestamps, they are exposed to the caller.
- **Recommended Correction:** Map the database model to an explicit response DTO class:
  ```typescript
  return new InvitationResponseDto({
    id: invitation.id,
    teamId: invitation.teamId,
    email: invitation.email,
    status: invitation.status,
    createdAt: invitation.createdAt,
  });
  ```
- **Detection Test:** Verify response keys strictly match the properties of `InvitationResponseDto`.

---

## 5. Test Coverage (Severity: High)

### Finding 5.1: Reused Mock Return Values Masking Defective SQL Operations
- **Problematic Code:**
  ```javascript
  const mockDb = { query: jest.fn().mockResolvedValue({ id: 1, name: "Team A" }) };
  ```
- **Failure Category:** Test Coverage — Tautological Mocking.
- **Severity:** **HIGH**.
- **Why It Is a Defect:** The test configures `mockDb.query` to return `{ id: 1, name: "Team A" }` for *every* query.
  - Call 1 is a `SELECT * FROM teams` query.
  - Call 2 is an `INSERT INTO invitations` query.
  - The mock returns a *Team* object for an *Invitation insert*!
  - The test passes, but the code in production would fail or return completely invalid invitation payloads. The test verifies nothing about SQL query correctness.
- **Recommended Correction:** Use sequence-aware mocking or integration testing against a test database:
  ```typescript
  mockDb.query
    .mockResolvedValueOnce({ id: "team-1", name: "Alpha Team" }) // SELECT
    .mockResolvedValueOnce({ id: "inv-1", email: "test@example.com", status: "pending" }); // INSERT
  ```
- **Detection Test:** Run test where `mockDb.query` asserts exact SQL parameters for both calls.

---

### Finding 5.2: Trivial HTTP 201 Assertion (The 100% Coverage / 0% Confidence Antipattern)
- **Problematic Code:**
  ```javascript
  await createInvitation(req, res);
  expect(res.status).toHaveBeenCalledWith(201);
  ```
- **Failure Category:** Test Coverage — Insufficient Assertion Density.
- **Severity:** **HIGH**.
- **Why It Is a Defect:** The test asserts only that `res.status` was called with `201`.
  - It does **not** assert `res.json` was called with valid data.
  - It does **not** assert that `db.query` was invoked with the expected parameters.
  - It does **not** assert that `emailService.send` was invoked with the correct recipient or team name.
  - The handler could literally send an email to a competitor and return `{ data: null }`, and this test would still pass green!
- **Recommended Correction:** Add comprehensive behavioral assertions:
  ```typescript
  expect(res.status).toHaveBeenCalledWith(201);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ email: "invitee@test.com" }),
  }));
  expect(mockEmail.send).toHaveBeenCalledWith(
    "invitee@test.com",
    "You've been invited!",
    expect.objectContaining({ teamName: "Alpha Team" }),
  );
  ```
- **Detection Test:** Introduce a mutation where `emailService.send` receives `null`; verify the test fails.

---

### Finding 5.3: Complete Absence of Adversarial & Negative Test Suites
- **Problematic Code:** Exactly one test in the suite (`describe("createInvitation")` with one `it` block).
- **Failure Category:** Test Coverage — Missing Negative Paths.
- **Severity:** **HIGH**.
- **Why It Is a Defect:** Zero tests exist for any failure condition.
- **Missing Required Test Matrix:**
  1. *Negative Auth:* Should return 401 when `req.user` is missing.
  2. *Negative Authorization:* Should return 403 when `req.user` is not an admin of `teamId`.
  3. *Negative Not Found:* Should return 404 when `teamId` does not exist.
  4. *Negative Validation:* Should return 400 when `email` is invalid, null, or empty.
  5. *Negative Conflict:* Should return 409 when invitee is already a member or pending.
  6. *Negative Service Failure:* Should return 500 and execute compensation when email dispatch fails.
  7. *Security Abuse:* Should verify SQL injection payloads do not execute.
- **Recommended Correction:** Implement the full 7-scenario test suite.

---

## 6. Summary Comparison: AI-Generated vs. Senior Production Implementation

| Dimension | AI-Generated Code (Audited) | Senior Production Standard |
| :--- | :--- | :--- |
| **Data Querying** | Raw SQL with template literals (SQL Injection) | Parameterized Prisma ORM query (`this.prisma.team.findUnique`) |
| **Authorization** | Checks `!req.user` only (IDOR vulnerability) | Verifies caller role in `team_members` (`OWNER`/`ADMIN`) |
| **Input Validation** | None; accepts null/empty/malformed strings | Strict DTO validation (`class-validator` `@IsEmail()`, `@MaxLength(255)`) |
| **Email Delivery** | Unprotected dual-write; leaves orphan DB record | Transactional Outbox pattern or BullMQ background worker |
| **Error Handling** | Swallows errors to `console.log`; generic 500 | Throws NestJS exceptions; serialized by `AllExceptionsFilter` |
| **Logging** | Plaintext PII in `console.log` | `StructuredLoggerService` with automated sensitive text redaction |
| **Response Contract** | Raw `{ data: invitation }` RETURNING * | Sanitized `InvitationResponseDto` |
| **Test Quality** | 1 happy-path test; tautological mock; asserts 201 only | Unit & integration tests with negative cases, payload assertions, and mock isolation |

---

## 7. Conclusion & Next Steps

This audit demonstrates that **superficial code correctness is a trap in AI-assisted engineering**. The AI generated code that looks fluent and passes a basic happy-path test, yet contains two Critical security flaws and multiple production-breaking bugs.

Senior peer review requires moving beyond syntax and actively interrogating the **Five Failure Modes**: Security, Edge Cases, Error Handling, Naming, and Tests.

