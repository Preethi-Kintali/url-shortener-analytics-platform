// ============================================================================
// MODULE 07 STEP 5: BREAK — PRIVILEGE ESCALATION REPRODUCTION
// ============================================================================
// Scenario: A viewer on your team just became an admin.
// Nobody changed their role through the admin interface.
// No admin ran an update query. The viewer did it themselves.
//
// Root Cause:
// 1. Authorization Failure (SEC-01): PUT /teams/:id/members/:uid enforces
//    only `isTeamMember` (membership existence), NOT `isTeamAdmin`.
// 2. Input Validation Failure (SEC-02): Payload `role` is unvalidated and
//    accepts arbitrary strings including 'admin', 'superadmin', etc.
// 3. Unconstrained Target: When :uid matches the caller's own userId, the
//    viewer mutates their own database record to ADMIN.
// ============================================================================

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { TeamMembersService } = require('./team-members.service');
const { TeamMembersController } = require('./team-members.controller');
const { VulnerableTeamMembersService } = require('./team-members-vulnerable.service');
const { VulnerableTeamMembersController } = require('./team-members-vulnerable.controller');

const logFile = path.join(__dirname, 'break-repro-output.txt');
const logs = [];

function log(msg) {
  console.log(msg);
  logs.push(msg);
}

log('================================================================================');
log('MODULE 07 STEP 5: BREAK — THE PRIVILEGE ESCALATION REPRODUCTION');
log(`Timestamp: ${new Date().toISOString()}`);
log('Scenario: Viewer Self-Elevation via Vulnerable PUT /teams/:id/members/:uid');
log('================================================================================\n');

let passCount = 0;
let failCount = 0;

function assertTest(desc, fn) {
  try {
    fn();
    log(`[PASS] ${desc}`);
    passCount++;
  } catch (err) {
    log(`[FAIL] ${desc}: ${err.message}`);
    failCount++;
  }
}

// ----------------------------------------------------------------------------
// FIXTURE FACTORY
// ----------------------------------------------------------------------------
function createTestFixtures() {
  const teamStore = new Map();
  const membershipStore = new Map();

  // Team Alpha (owned by Alice)
  teamStore.set('team_alpha', { id: 'team_alpha', name: 'Alpha Team', ownerId: 'usr_alice' });
  membershipStore.set('team_alpha:usr_alice', { teamId: 'team_alpha', userId: 'usr_alice', role: 'OWNER' });
  membershipStore.set('team_alpha:usr_admin', { teamId: 'team_alpha', userId: 'usr_admin', role: 'ADMIN' });
  membershipStore.set('team_alpha:usr_member', { teamId: 'team_alpha', userId: 'usr_member', role: 'MEMBER' });
  membershipStore.set('team_alpha:usr_viewer', { teamId: 'team_alpha', userId: 'usr_viewer', role: 'VIEWER' });
  membershipStore.set('team_alpha:usr_target', { teamId: 'team_alpha', userId: 'usr_target', role: 'MEMBER' });

  // Team Beta (isolated tenant)
  teamStore.set('team_beta', { id: 'team_beta', name: 'Beta Team', ownerId: 'usr_charlie' });
  membershipStore.set('team_beta:usr_charlie', { teamId: 'team_beta', userId: 'usr_charlie', role: 'OWNER' });
  membershipStore.set('team_beta:usr_bob', { teamId: 'team_beta', userId: 'usr_bob', role: 'MEMBER' });

  return { teamStore, membershipStore };
}

// ----------------------------------------------------------------------------
// MOCK HTTP RESPONSE FACTORY
// ----------------------------------------------------------------------------

function createMockResponse() {
  const res = {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
  };
  return res;
}

// ============================================================================
// PART 1: FORENSIC INVESTIGATION — TRACING THE VULNERABLE REQUEST PATH
// ============================================================================
log('--- PART 1: Forensic Investigation & Exploit Path Trace ---');

{
  const { teamStore, membershipStore } = createTestFixtures();
  const vulnService = new VulnerableTeamMembersService(teamStore, membershipStore);
  const vulnController = new VulnerableTeamMembersController(vulnService);

  // 1. Initial State Inspection
  const initialViewerRecord = membershipStore.get('team_alpha:usr_viewer');
  log(`[STATE 0] Initial Viewer Record: teamId=${initialViewerRecord.teamId}, userId=${initialViewerRecord.userId}, role=${initialViewerRecord.role}`);

  assertTest('Trace Step 1: Initial state confirms usr_viewer has lowest permission role VIEWER', () => {
    assert.strictEqual(initialViewerRecord.role, 'VIEWER');
  });

  // 2. Attacker Request Formulation
  const attackRequest = {
    method: 'PUT',
    route: '/teams/:id/members/:uid',
    params: { id: 'team_alpha', uid: 'usr_viewer' }, // Attacker targets THEIR OWN UID
    headers: { 'x-user-id': 'usr_viewer' },
    user: { id: 'usr_viewer', email: 'viewer@alpha.internal' }, // Authenticated as VIEWER
    body: { role: 'admin' }, // Elevating role to admin
  };

  log(`[ATTACK INPUT] Attacker (usr_viewer) dispatches:`);
  log(`  Route:  PUT /teams/${attackRequest.params.id}/members/${attackRequest.params.uid}`);
  log(`  Caller: ${attackRequest.user.id} (Role: VIEWER)`);
  log(`  Target: ${attackRequest.params.uid} (Self-Target)`);
  log(`  Body:   ${JSON.stringify(attackRequest.body)}`);

  // 3. Execution of Vulnerable Controller & Service
  const res = createMockResponse();
  vulnController.updateMemberRoleHandler(attackRequest, res);

  // 4. Assert HTTP 200 OK and Exploit Success
  assertTest('Trace Step 2: Vulnerable controller returns HTTP 200 OK (Bypass of Admin Check)', () => {
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.member.role, 'admin');
  });

  // 5. Posterior State Inspection
  const postViewerRecord = membershipStore.get('team_alpha:usr_viewer');
  log(`[STATE 1] Posterior Viewer Record in Store: role=${postViewerRecord.role}`);

  assertTest('Trace Step 3: Persistence store reflects usr_viewer role mutated from VIEWER to admin', () => {
    assert.strictEqual(postViewerRecord.role, 'admin');
  });

  // 6. Impact Verification: Exploiting New Administrative Status
  assertTest('Trace Step 4: Newly escalated usr_viewer can now update other members', () => {
    // The newly elevated viewer now invokes update on another member
    const promoteTargetReq = vulnService.updateMemberRole('team_alpha', 'usr_viewer', 'usr_target', 'admin');
    assert.strictEqual(promoteTargetReq.member.role, 'admin');
  });
}

// ============================================================================
// PART 2: COMPOSITE EXPLOIT VARIATIONS (ARBITRARY ROLE INJECTION & HORIZONTAL)
// ============================================================================
log('\n--- PART 2: Composite Exploit Variations on Vulnerable Baseline ---');

{
  const { teamStore, membershipStore } = createTestFixtures();
  const vulnService = new VulnerableTeamMembersService(teamStore, membershipStore);

  assertTest('Exploit Variation 2.1: Viewer injects arbitrary role "superadmin"', () => {
    const res = vulnService.updateMemberRole('team_alpha', 'usr_viewer', 'usr_viewer', 'superadmin');
    assert.strictEqual(res.member.role, 'superadmin');
    assert.strictEqual(membershipStore.get('team_alpha:usr_viewer').role, 'superadmin');
  });

  assertTest('Exploit Variation 2.2: Viewer injects arbitrary role "owner"', () => {
    const res = vulnService.updateMemberRole('team_alpha', 'usr_viewer', 'usr_viewer', 'owner');
    assert.strictEqual(res.member.role, 'owner');
    assert.strictEqual(membershipStore.get('team_alpha:usr_viewer').role, 'owner');
  });

  assertTest('Exploit Variation 2.3: Viewer elevates another ordinary member to admin', () => {
    const res = vulnService.updateMemberRole('team_alpha', 'usr_viewer', 'usr_target', 'admin');
    assert.strictEqual(res.member.role, 'admin');
    assert.strictEqual(membershipStore.get('team_alpha:usr_target').role, 'admin');
  });
}

// ============================================================================
// PART 3: PROVING THE REMEDIATED IMPLEMENTATION (STEP 4) NEUTRALIZES THE EXPLOIT
// ============================================================================
log('\n--- PART 3: Verifying Remediated Implementation Fails Closed ---');

{
  const { teamStore, membershipStore } = createTestFixtures();
  const fixedService = new TeamMembersService(teamStore, membershipStore);
  const fixedController = new TeamMembersController(fixedService);

  assertTest('Remediation Check 3.1: Viewer self-elevation is blocked by service with 403 FORBIDDEN', () => {
    let thrownError = null;
    try {
      fixedService.updateMemberRole('team_alpha', 'usr_viewer', 'usr_viewer', 'admin');
    } catch (err) {
      thrownError = err;
    }

    assert(thrownError !== null, 'Expected error to be thrown');
    assert.strictEqual(thrownError.statusCode, 403);
    assert.strictEqual(thrownError.code, 'FORBIDDEN');
    assert.strictEqual(thrownError.message, 'Insufficient permissions to modify team member roles');
  });

  assertTest('Remediation Check 3.2: Viewer role remains strictly VIEWER in store after attack', () => {
    const viewerRecord = membershipStore.get('team_alpha:usr_viewer');
    assert.strictEqual(viewerRecord.role, 'VIEWER');
  });

  assertTest('Remediation Check 3.3: HTTP controller returns HTTP 403 with standard error envelope', async () => {
    const attackRequest = {
      params: { id: 'team_alpha', uid: 'usr_viewer' },
      user: { id: 'usr_viewer' },
      body: { role: 'admin' },
    };
    const res = createMockResponse();
    await fixedController.updateMemberRoleHandler(attackRequest, res);

    assert.strictEqual(res.statusCode, 403);
    assert.deepStrictEqual(res.body, {
      error: {
        code: 'FORBIDDEN',
        message: 'Insufficient permissions to modify team member roles',
      },
    });
  });

  assertTest('Remediation Check 3.4: Legitimate ADMIN can still update member roles to valid enums', () => {
    const res = fixedService.updateMemberRole('team_alpha', 'usr_admin', 'usr_target', 'viewer');
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.member.role, 'VIEWER');
  });

  assertTest('Remediation Check 3.5: Legitimate ADMIN cannot assign unvalidated role "superadmin" (400)', () => {
    let thrownError = null;
    try {
      fixedService.updateMemberRole('team_alpha', 'usr_admin', 'usr_target', 'superadmin');
    } catch (err) {
      thrownError = err;
    }
    assert(thrownError !== null);
    assert.strictEqual(thrownError.statusCode, 400);
    assert.strictEqual(thrownError.code, 'BAD_REQUEST');
  });
}

// ============================================================================
// PART 4: BOUNDARY ANALYSIS & CROSS-TENANT ISOLATION
// ============================================================================
log('\n--- PART 4: Boundary Analysis & Cross-Tenant Isolation ---');

{
  const { teamStore, membershipStore } = createTestFixtures();
  const fixedService = new TeamMembersService(teamStore, membershipStore);

  assertTest('Boundary Check 4.1: Cross-tenant attacker (Team Beta) cannot access Team Alpha (403)', () => {
    let thrownError = null;
    try {
      fixedService.updateMemberRole('team_alpha', 'usr_charlie', 'usr_viewer', 'admin');
    } catch (err) {
      thrownError = err;
    }
    assert(thrownError !== null);
    assert.strictEqual(thrownError.statusCode, 403);
  });

  assertTest('Boundary Check 4.2: Unauthenticated attacker cannot modify roles (401)', () => {
    let thrownError = null;
    try {
      fixedService.updateMemberRole('team_alpha', null, 'usr_viewer', 'admin');
    } catch (err) {
      thrownError = err;
    }
    assert(thrownError !== null);
    assert.strictEqual(thrownError.statusCode, 401);
  });
}

// ----------------------------------------------------------------------------
// SUMMARY & LOG PERSISTENCE
// ----------------------------------------------------------------------------
log('\n================================================================================');
log(`TEST SUITE RESULTS: ${passCount} PASSED, ${failCount} FAILED, ${passCount + failCount} TOTAL`);
log('================================================================================');

fs.writeFileSync(logFile, logs.join('\n') + '\n', 'utf8');
log(`\nReproduction output preserved to ${logFile}`);

if (failCount > 0) {
  process.exit(1);
}
