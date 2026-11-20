# Module 07 — Security & Architecture Review
## Step 6: FIX — Trace, Explain, Patch, Verify Report

**Course**: Upsk AI-Augmented Engineering (Pack 3: Operator)  
**Module**: 07 — Security & Architecture Review  
**Step**: STEP 6: FIX — Trace, Explain, Patch, Verify  
**Date**: November 18, 2026  
**Author**: Tech Lead / Operator  
**Status**: Implemented, Verified & Fully Passing (25/25 Tests)  

---

## 1. Tracing the Vulnerability & Exploit Chain

The privilege escalation vulnerability in `PUT /teams/:id/members/:uid` consists of two fatal links in the execution chain:

1. **Broken Function-Level Authorization (SEC-01)**:  
   The route uses `isTeamMember` middleware/check, which verifies strictly whether the requesting user belongs to the team. It does **not** check whether the user has administrative privileges to modify roles. Any team member — including a read-only `VIEWER` — passes this check.
2. **Missing Input Validation & Privilege Ceiling (SEC-02)**:  
   The route handler accepts a `role` field in the request body and writes it directly to the persistence store without validating whether the requesting user is allowed to assign that value. No check enforced that *"only admins and owners can change roles."*

Either link alone creates security flaws. Together, they make exploitation trivial. A single HTTP request:

```bash
curl -X PUT /teams/123/members/456 \
  -H "Authorization: Bearer <viewer-token>" \
  -H "Content-Type: application/json" \
  -d '{"role": "admin"}'
```

Because `456` is the viewer's own user ID, the viewer's role is immediately mutated to `admin`. The viewer self-promotes to the highest operational privilege level with zero interaction from an administrator.

---

## 2. Root Cause: Why AI Missed It

This vulnerability provides the quintessential case study for AI-augmented engineering:

- **What the AI was told**: Build an endpoint to update team member roles.
- **What the AI did**: It built an endpoint that accepts a role and updates the database record.
- **What roles exist**: `admin`, `member`, `viewer`. The AI utilized these strings.
- **What auth was requested**: Protect endpoints with team authentication.
- **How the AI interpreted the requirement**: The requirement stated *"team members can have their roles updated."* The AI interpreted *"team members"* as the access level (who can call it) rather than solely the subject of the update (whose role is changed).

### The Letter vs. The Spirit
The AI verified the **letter** of the requirements:
> *"Is the user a team member? Yes. Can team members have their roles updated? Yes. Proceed."*

It did not verify the **spirit**:
> Nobody explicitly said *"only admins can change roles"*, so the AI did not enforce it. It never occurred to the AI that a viewer updating their own role to admin constitutes a critical privilege escalation, because *"privilege escalation"* is a high-level semantic concept requiring an understanding of the **purpose** and **trust boundaries** of roles, not merely their syntactic presence.

```
+-------------------------------------------------------------+
| AI checks syntax.       | Humans check semantics.           |
| AI validates structure. | Humans validate intent & context. |
+-------------------------------------------------------------+
```

---

## 3. The Production-Grade Fix Specification (Six Explicit Constraints)

A vague fix prompt (*"fix the role update endpoint security"*) typically results in an AI adding a single partial check while leaving self-escalation or owner promotion vulnerabilities wide open.

In contrast, our production-grade fix prompt enforced six explicit architectural constraints:

```text
"Fix the privilege escalation vulnerability in PUT /teams/:id/members/:uid. The current implementation allows any team member to update any other member's role, including their own. Apply these constraints:

1. Only users with 'admin' or 'owner' role on the team can modify member roles. Replace the isTeamMember middleware with isTeamAdminOrOwner. If the requester does not have admin or owner role, return 403.
2. A user cannot modify their own role. If the userId in the route param matches the requesting user's ID, return 403 with message 'Cannot modify your own role.'
3. Validate the role field against the enum ['admin', 'member', 'viewer']. Reject any other value with 400.
4. An admin cannot promote another user to owner. Only owners can create other owners. If the requester is an admin and the target role is 'owner', return 403.
5. Add the audit log entry for role changes: log the team ID, the target user ID, the old role, the new role, and the requesting user ID.
6. Write tests for each constraint: viewer cannot escalate, member cannot escalate, admin can change member/viewer roles, admin cannot promote to owner, owner can do everything, self-modification is blocked."
```

---

## 4. Security Boundary & Identity Analysis

### Trusted Identity vs. Untrusted Request Headers
- **Production Vulnerability**: Treating `req.headers['x-user-id']` as trusted identity is a critical flaw in production systems. Any external client, proxy, or attacker can inject arbitrary headers unless explicitly stripped by a perimeter gateway.
- **Our Architecture**:
  - In [team-members.controller.js](team-members.controller.js), caller identity is derived strictly from `req.user.id` (populated by cryptographically validated JWT middleware).
  - Header inspection is restricted strictly as an explicit test mock fallback, clearly documented with architectural guardrails.
  - Missing caller identity throws HTTP 401 `UNAUTHORIZED`.

### Complete Decision Matrix:
| Caller Role | Target User | Target Role | Action Allowed? | Status Code & Envelope |
| :--- | :--- | :--- | :--- | :--- |
| `VIEWER` | Self / Other | Any | **DENIED** | `403 FORBIDDEN` (Insufficient permissions) |
| `MEMBER` | Self / Other | Any | **DENIED** | `403 FORBIDDEN` (Insufficient permissions) |
| `ADMIN` | Self (`target === caller`) | Any | **DENIED** | `403 FORBIDDEN` ("Cannot modify your own role") |
| `ADMIN` | Other Member | `owner` | **DENIED** | `403 FORBIDDEN` (Only owners can create owners) |
| `ADMIN` | Other Owner | Any | **DENIED** | `403 FORBIDDEN` (Cannot demote team owner) |
| `ADMIN` | Other Member | `superadmin` / `""` | **DENIED** | `400 BAD_REQUEST` (Invalid role enum) |
| `ADMIN` | Other Member | `member` / `viewer` | **ALLOWED** | `200 OK` (Audit log created) |
| `OWNER` | Self (`target === caller`) | Any | **DENIED** | `403 FORBIDDEN` ("Cannot modify your own role") |
| `OWNER` | Other Member | `admin` / `owner` | **ALLOWED** | `200 OK` (Audit log created) |
| Any | Non-existent user | Any | **DENIED** | `404 NOT_FOUND` |
| Any | Non-existent team | Any | **DENIED** | `404 NOT_FOUND` |
| Any | Foreign team member | Any | **DENIED** | `403 FORBIDDEN` (Cross-tenant boundary) |

---

## 5. Verification & Test Suite Execution

We executed the official Step 6 test suite [test-step6-fix.js](test-step6-fix.js) covering all 13 official Upsk acceptance tests, plus 12 additional boundary and integration tests:

Command:
```bash
node progress/evidence/module-07/test-step6-fix.js
```

### Official Acceptance Test Log ([fix-test-output.txt](fix-test-output.txt)):
```text
================================================================================
MODULE 07 STEP 6: FIX — TEAM MEMBER ROLE VERIFICATION SUITE
Timestamp: 2026-11-18T18:20:54.995Z
Evaluating 6 Security Constraints and 13 Official Acceptance Tests
================================================================================

--- PART 1: The 13 Official Upsk Step 6 Acceptance Tests ---
[PASS] Test 01: Viewer tries to update own role to admin: 403
[PASS] Test 02: Viewer tries to update another member's role: 403
[PASS] Test 03: Member tries to update own role to admin: 403
[PASS] Test 04: Member tries to update another member's role: 403
[PASS] Test 05: Admin updates a viewer to member: 200
[PASS] Test 06: Admin updates a member to viewer: 200
[PASS] Test 07: Admin tries to promote member to owner: 403
[PASS] Test 08: Admin tries to update own role: 403
[PASS] Test 09: Owner updates a member to admin: 200
[PASS] Test 10: Owner promotes a member to owner: 200
[PASS] Test 11: Owner tries to update own role: 403
[PASS] Test 12: Any user sends role value "superadmin": 400
[PASS] Test 13: Any user sends role value "": 400

--- PART 2: Security Boundaries, Audit Logging & Edge Cases ---
[PASS] Test 14: Admin cannot demote team owner: 403
[PASS] Test 15: Non-existent team rejected with 404
[PASS] Test 16: Non-existent target user rejected with 404
[PASS] Test 17: Cross-tenant caller rejected with 403
[PASS] Test 18: Unauthenticated caller rejected with 401
[PASS] Test 19: Anonymous caller rejected with 401
[PASS] Test 20: Malformed non-string role rejected with 400
[PASS] Test 21: Audit logging captures teamId, targetUserId, oldRole, newRole, requestingUserId

--- PART 3: Controller HTTP Integration & Envelope Verification ---
[PASS] Test 22: Controller maps successful update to HTTP 200 with JSON body
[PASS] Test 23: Controller maps unauthorized request to HTTP 403 SafeErrorEnvelope
[PASS] Test 24: Controller maps invalid role to HTTP 400 SafeErrorEnvelope
[PASS] Test 25: Controller maps missing caller identity to HTTP 401 SafeErrorEnvelope

================================================================================
TEST SUITE RESULTS: 25 PASSED, 0 FAILED, 25 TOTAL
================================================================================
```

---

## 6. Comprehensive Regression Integrity Across All Modules

To ensure absolute stability, the full historical test suite was re-executed:
1. **Module 07 Step 6 Fix Suite (`test-step6-fix.js`)**: **25 / 25 PASSED**
2. **Module 07 Step 4 Verification Suite (`test-team-members-fix.js`)**: **21 / 21 PASSED**
3. **Module 07 Step 5 BREAK Reproduction (`repro-privilege-escalation.js`)**: **14 / 14 PASSED**
4. **Module 06 Multi-Agent Integration Suite (`test-step6-regression.js`)**: **28 / 28 PASSED**
5. **Module 05 Real-Time Gateway Replay Suite (`test-fix-regressions.js`)**: **17 / 17 PASSED**
6. **Module 04 IDOR Authorization Suite (`test-invitation-idor-fix.js`)**: **22 / 22 PASSED**

**Total Test Count**: **127 / 127 assertions passed across all modules with 0 failures and 0 regressions.**

---

## 7. Deliverables & Git Status

- **Fixed Service Implementation**: [team-members.service.js](team-members.service.js)
- **Fixed Controller Implementation**: [team-members.controller.js](team-members.controller.js)
- **Vulnerable Baseline References**: [team-members-vulnerable.service.js](team-members-vulnerable.service.js) and [team-members-vulnerable.controller.js](team-members-vulnerable.controller.js)
- **Step 6 Verification Harness**: [test-step6-fix.js](test-step6-fix.js)
- **Step 6 Test Output**: [fix-test-output.txt](fix-test-output.txt)
- **Production Integrity**: Production files in `api/src/` remain completely untouched. Git working tree on `github-public` is clean on all tracked files.
