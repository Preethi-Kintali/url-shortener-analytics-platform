# Module 04 FIX: Remediating Broken Object-Level Authorization (IDOR)

## 1. Codebase Inspection & Infrastructure Reality Report

### Inspection of the Real Production Codebase
Prior to designing or applying the remediation, a systematic inspection of the workspace was conducted:
1. **Production Routes & Authentication (`api/src/`):**
   - [api/src/links/links.controller.ts](../../../api/src/links/links.controller.ts) uses `@UseGuards(JwtAuthGuard)` and `@CurrentPrincipal() principalId: string` to extract caller identity.
   - [api/src/auth/decorators/current-principal.decorator.ts](../../../api/src/auth/decorators/current-principal.decorator.ts) inspects `request.user.principal_id` and throws `UnauthorizedException` if absent.
   - [api/src/links/links.service.ts](../../../api/src/links/links.service.ts) implements resource-level scoping on links using `where: { id, createdBy: ownerId }`, returning `NotFoundException` (404) on unauthorized access to prevent principal enumeration.
2. **Database Schema (`api/prisma/schema.prisma`):**
   - The PostgreSQL database schema currently defines `Link` and `ClickEvent` models.
3. **Repository Reality Report:**
   - As mandated by the inspection protocol: **the directory `api/src/teams/` and the relational models `Team` / `TeamMember` do not exist in the tracked git repository on branch `github-public`**.
   - The Team Collaboration feature was architected and specified across Modules 02, 03, and 04 (`progress/interface-contracts.md`, `progress/context-packages.md`, `progress/code-review-audit.md`), and the team invitation handler served as the official micro-exercise audited in Step 1, Step 3, Step 4, and Step 5.
   - All tests and verifications for this step are executed against a fully typed NestJS service and controller harness modeled strictly after the application's real conventions, without hallucinating production database deployments.

---

## 2. Targeted Implementation Prompt

Following the prompt engineering principles taught in Upsk Step 2:

### Comparison: Bad Prompt vs. Targeted Remediation Prompt

#### The Bad Prompt (Why It Fails):
> *"Fix the security issue in the invitation endpoint."*
- **Failure Mode:** Too ambiguous. An LLM may hallucinate rate limiting, add generic input sanitization, insert a superficial `// TODO: fix security` comment, or refactor the entire function, inadvertently breaking working behavior.

#### The Targeted Production Prompt (Used for the Fix):
```text
In the team invitation module (POST /teams/:teamId/invitations), fix the Insecure Direct Object Reference (IDOR) by adding resource-level authorization between authentication and database insertion.

Follow these strict constraints:
1. Route & Principal:
   - Route: POST /teams/:teamId/invitations
   - Extract the authenticated user's ID via @CurrentPrincipal() (principalId) and the target team ID via @Param('teamId').
   - Reject unauthenticated requests immediately with HTTP 401 UnauthorizedException.

2. Authorization Verification:
   - Query the `team_members` table for a record matching the composite key:
     `{ teamId: teamId, userId: principalId }`
   - Verify that the returned record exists AND has `role === 'OWNER'` OR `role === 'ADMIN'`.
   - If no record exists, or if the user's role is 'MEMBER', immediately throw HTTP 403 ForbiddenException:
     "Forbidden: You do not have administrative permission to invite members to this team"

3. Order of Operations & Side Effects:
   - Perform the authorization check BEFORE any team member checks, duplicate invitation checks, database insertions, or email dispatches.
   - Denied requests (401, 403) must NEVER insert rows into `invitations` or call the email dispatch service.

4. Conventions & Negative Constraints:
   - Use standard Prisma client operations (`prisma.teamMember.findUnique`). Do NOT use raw SQL string interpolation.
   - Do NOT manually construct JSON error objects (e.g. `{ error: "Forbidden" }`). Throw standard NestJS HttpExceptions so the centralized AllExceptionsFilter serializes them into SafeErrorEnvelope.
   - Do not refactor or modify unrelated endpoint behavior.
```

---

## 3. The Minimal Fix Implementation

The remediated NestJS service was implemented in [progress/evidence/module-04/invitations.service.ts](../../evidence/module-04/invitations.service.ts) and controller in [progress/evidence/module-04/invitations.controller.ts](../../evidence/module-04/invitations.controller.ts).

### Core Authorization Code:
```typescript
// 1. Authentication Check
if (!principalId || typeof principalId !== 'string' || principalId.trim() === '') {
  throw new UnauthorizedException('Authenticated principal_id is required');
}

// 2. Input Validation
if (!rawEmail || typeof rawEmail !== 'string' || !EMAIL_REGEX.test(rawEmail.trim())) {
  throw new BadRequestException('Invalid email address format');
}
const cleanEmail = rawEmail.trim().toLowerCase();

// 3. Team Existence Verification
const team = await this.prisma.team.findUnique({
  where: { id: teamId },
});
if (!team) {
  throw new NotFoundException(`Team with ID '${teamId}' not found`);
}

// 4. CRITICAL IDOR FIX: Verify Caller Authorization on the Target Team
// Query team_members table for the composite key (teamId, principalId)
const callerMembership = await this.prisma.teamMember.findUnique({
  where: {
    teamId_userId: {
      teamId,
      userId: principalId,
    },
  },
});

// Enforce role-based permission: only OWNER or ADMIN can issue invitations
if (
  !callerMembership ||
  (callerMembership.role !== TeamRole.OWNER && callerMembership.role !== TeamRole.ADMIN)
) {
  throw new ForbiddenException(
    'Forbidden: You do not have administrative permission to invite members to this team',
  );
}

// 5. Existing Team Member Conflict Check
const existingMember = await this.prisma.teamMember.findFirst({
  where: { teamId, email: cleanEmail },
});
if (existingMember) {
  throw new ConflictException(`User with email '${cleanEmail}' is already a member of this team`);
}

// 6. Duplicate Active Invitation Check
const existingInvite = await this.prisma.invitation.findFirst({
  where: { teamId, email: cleanEmail, status: 'PENDING' },
});
if (existingInvite) {
  throw new ConflictException(`An active invitation is already pending for '${cleanEmail}'`);
}

// 7. Atomic Invitation Persistence
const newInvitation = await this.prisma.invitation.create({
  data: {
    id: `inv_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
    teamId,
    email: cleanEmail,
    invitedBy: principalId,
    status: 'PENDING',
  },
});

// 8. External Email Notification
await this.emailService.sendInvitationEmail(cleanEmail, team.name, newInvitation.id);

return {
  id: newInvitation.id,
  team_id: newInvitation.teamId,
  email: newInvitation.email,
  status: newInvitation.status,
};
```

---

## 4. Regression Verification & 5-Boundary Test Suite

The test suite in [progress/evidence/module-04/test-invitation-idor-fix.js](../../evidence/module-04/test-invitation-idor-fix.js) was executed using Node.js, asserting HTTP status codes, exception types, database mutation side effects, and email notifications.

### 5-Boundary Authorization Matrix

| Boundary | Persona / Context | Expected Result | Actual Result | Side Effect Verification | Status |
| :--- | :--- | :---: | :---: | :--- | :---: |
| **1. Unauthenticated** | Anonymous request (missing principal) | **HTTP 401** | **HTTP 401** `UnauthorizedException` | 0 DB rows created, 0 emails sent | **PASS** |
| **2. Non-Member** | Dave (`usr_dave_outsider`, from Team Beta) | **HTTP 403** | **HTTP 403** `ForbiddenException` | 0 DB rows created, 0 emails sent | **PASS** |
| **3. Ordinary Member** | Carol (`usr_carol_member`, role `MEMBER`) | **HTTP 403** | **HTTP 403** `ForbiddenException` | 0 DB rows created, 0 emails sent | **PASS** |
| **4. Team Admin** | Bob (`usr_bob_admin`, role `ADMIN`) | **HTTP 201** | **HTTP 201** `Created` | 1 DB row persisted, 1 email dispatched | **PASS** |
| **5. Team Owner** | Alice (`usr_alice_owner`, role `OWNER`) | **HTTP 201** | **HTTP 201** `Created` | 1 DB row persisted, 1 email dispatched | **PASS** |

### Additional Edge-Case Regressions

| Edge Case Test | Input / Scenario | Expected Exception | Actual Result | Status |
| :--- | :--- | :---: | :---: | :---: |
| **Existing Member** | Inviting `alice@core.io` who already belongs to team | **HTTP 409 Conflict** | `ConflictException` (409) | **PASS** |
| **Duplicate Invitation** | Re-inviting `dev-lead@core.io` with pending invite | **HTTP 409 Conflict** | `ConflictException` (409) | **PASS** |
| **Malformed Email** | Submitting `"invalid-email-address"` | **HTTP 400 Bad Request** | `BadRequestException` (400) | **PASS** |
| **Non-Existent Team** | Submitting `teamId = "non_existent_team_404"` | **HTTP 404 Not Found** | `NotFoundException` (404) | **PASS** |

### Execution Log Output
From [progress/evidence/module-04/invitation-fix-test-output.txt](../../evidence/module-04/invitation-fix-test-output.txt):

```text
================================================================================
UPSK MODULE 04 — STEP 6: FIX (IDOR REMEDIATION & REGRESSION TEST SUITE)
Timestamp: 2026-11-17T18:41:08.100Z
Audited Service: RemediatedInvitationsService (NestJS Component)
Audited Controller: RemediatedInvitationsController (POST /teams/:teamId/invitations)
Target Resource: Team Alpha (team_alpha_01)
================================================================================

--- TEST 1: Unauthenticated User (Missing Principal) ---
[PASS] Unauthenticated request throws UnauthorizedException (HTTP 401) — Status: 401, Message: "Authenticated principal_id is required"
[PASS] Side effect check: 0 invitations created in database on 401
[PASS] Side effect check: 0 emails dispatched on 401

--- TEST 2: Authenticated Non-Member (Cross-Tenant Intrusion Attempt) ---
[PASS] Authenticated non-member is blocked with ForbiddenException (HTTP 403) — Status: 403, Message: "Forbidden: You do not have administrative permission to invite members to this team"
[PASS] Side effect check: 0 invitations created in database on 403 (Non-member)
[PASS] Side effect check: 0 emails dispatched on 403 (Non-member)

--- TEST 3: Authenticated Ordinary Team Member (Privilege Escalation Attempt) ---
[PASS] Ordinary member (role MEMBER) is blocked with ForbiddenException (HTTP 403) — Status: 403, Message: "Forbidden: You do not have administrative permission to invite members to this team"
[PASS] Side effect check: 0 invitations created in database on 403 (Member)
[PASS] Side effect check: 0 emails dispatched on 403 (Member)

--- TEST 4: Authenticated Team Administrator (Legitimate Admin Access) ---
[PASS] Team Admin successfully issues invitation (HTTP 201 Created) — id=inv_1794940868121_2309, email=dev-lead@core.io
[PASS] Side effect check: 1 invitation persisted in database
[PASS] Side effect check: 1 email dispatched to invitee
[PASS] Email payload verified: correct recipient and team context

--- TEST 5: Authenticated Team Owner (Legitimate Owner Access) ---
[PASS] Team Owner successfully issues invitation (HTTP 201 Created) — id=inv_1794940868125_172, email=director-eng@core.io
[PASS] Side effect check: 2 total invitations in database
[PASS] Side effect check: 2 total emails dispatched

--- TEST 6: Conflict on Existing Team Member ---
[PASS] Inviting existing team member rejected with ConflictException (HTTP 409) — Status: 409, Message: "User with email 'alice@core.io' is already a member of this team"
[PASS] Side effect check: No new record created on 409 conflict
[PASS] Side effect check: No email sent on 409 conflict

--- TEST 7: Conflict on Duplicate Active Invitation ---
[PASS] Duplicate pending invitation rejected with ConflictException (HTTP 409) — Status: 409, Message: "An active invitation is already pending for 'dev-lead@core.io'"

--- TEST 8: Malformed Email Input ---
[PASS] Malformed email rejected with BadRequestException (HTTP 400) — Status: 400, Message: "Invalid email address format"

--- TEST 9: Non-Existent Team ID ---
[PASS] Non-existent team rejected with NotFoundException (HTTP 404) — Status: 404, Message: "Team with ID 'non_existent_team_404' not found"

================================================================================
SUMMARY: 22 of 22 assertions PASSED
================================================================================
```

---

## 5. The Architectural Lesson

> **"AI generates the feature. Human catches the security hole."**

- **Why this division of labor exists:**
  Generative AI completes statistically likely code patterns. In public software, authentication is ubiquitous, but authorization is domain-specific. The model cannot know your tenancy rules, role hierarchies, or data isolation boundaries unless you explicitly engineer that context into every prompt.
- **The Engineer's Responsibility:**
  The engineer must define precise preconditions, supply domain schemas, specify exact queries, and independently verify authorization boundaries before deploying AI-generated code.

