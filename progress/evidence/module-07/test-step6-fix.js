// ============================================================================
// MODULE 07 STEP 6: FIX — TEAM MEMBER ROLE REMEDIATION VERIFICATION SUITE
// ============================================================================
// Verifies the production-grade fix for PUT /teams/:id/members/:uid.
// Includes all 13 official Upsk Step 6 test cases plus security boundary checks.
// ============================================================================

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { TeamMembersService, VALID_TARGET_ROLES } = require('./team-members.service');
const { TeamMembersController } = require('./team-members.controller');

const logFile = path.join(__dirname, 'fix-test-output.txt');
const logs = [];

function log(msg) {
  console.log(msg);
  logs.push(msg);
}

log('================================================================================');
log('MODULE 07 STEP 6: FIX — TEAM MEMBER ROLE VERIFICATION SUITE');
log(`Timestamp: ${new Date().toISOString()}`);
log('Evaluating 6 Security Constraints and 13 Official Acceptance Tests');
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
// TEST FIXTURES
// ----------------------------------------------------------------------------
function createTestFixtures() {
  const teamStore = new Map();
  const membershipStore = new Map();
  const auditLog = [];

  // Team Alpha
  teamStore.set('team_alpha', { id: 'team_alpha', name: 'Alpha Team', ownerId: 'usr_alice' });
  membershipStore.set('team_alpha:usr_alice', { teamId: 'team_alpha', userId: 'usr_alice', role: 'OWNER' });
  membershipStore.set('team_alpha:usr_admin', { teamId: 'team_alpha', userId: 'usr_admin', role: 'ADMIN' });
  membershipStore.set('team_alpha:usr_member', { teamId: 'team_alpha', userId: 'usr_member', role: 'MEMBER' });
  membershipStore.set('team_alpha:usr_viewer', { teamId: 'team_alpha', userId: 'usr_viewer', role: 'VIEWER' });
  membershipStore.set('team_alpha:usr_target', { teamId: 'team_alpha', userId: 'usr_target', role: 'VIEWER' });

  // Team Beta (isolated tenant)
  teamStore.set('team_beta', { id: 'team_beta', name: 'Beta Team', ownerId: 'usr_charlie' });
  membershipStore.set('team_beta:usr_charlie', { teamId: 'team_beta', userId: 'usr_charlie', role: 'OWNER' });
  membershipStore.set('team_beta:usr_bob', { teamId: 'team_beta', userId: 'usr_bob', role: 'MEMBER' });

  return { teamStore, membershipStore, auditLog };
}

function createMockResponse() {
  return {
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
}

// ============================================================================
// PART 1: THE 13 OFFICIAL UPSK STEP 6 ACCEPTANCE TESTS
// ============================================================================
log('--- PART 1: The 13 Official Upsk Step 6 Acceptance Tests ---');

{
  const { teamStore, membershipStore, auditLog } = createTestFixtures();
  const service = new TeamMembersService(teamStore, membershipStore, auditLog);

  // Test 1: Viewer tries to update own role to admin: 403
  assertTest('Test 01: Viewer tries to update own role to admin: 403', () => {
    let err = null;
    try {
      service.updateMemberRole('team_alpha', 'usr_viewer', 'usr_viewer', 'admin');
    } catch (e) {
      err = e;
    }
    assert(err !== null, 'Expected error thrown');
    assert.strictEqual(err.statusCode, 403);
  });

  // Test 2: Viewer tries to update another member\'s role: 403
  assertTest('Test 02: Viewer tries to update another member\'s role: 403', () => {
    let err = null;
    try {
      service.updateMemberRole('team_alpha', 'usr_viewer', 'usr_target', 'admin');
    } catch (e) {
      err = e;
    }
    assert(err !== null);
    assert.strictEqual(err.statusCode, 403);
  });

  // Test 3: Member tries to update own role to admin: 403
  assertTest('Test 03: Member tries to update own role to admin: 403', () => {
    let err = null;
    try {
      service.updateMemberRole('team_alpha', 'usr_member', 'usr_member', 'admin');
    } catch (e) {
      err = e;
    }
    assert(err !== null);
    assert.strictEqual(err.statusCode, 403);
  });

  // Test 4: Member tries to update another member\'s role: 403
  assertTest('Test 04: Member tries to update another member\'s role: 403', () => {
    let err = null;
    try {
      service.updateMemberRole('team_alpha', 'usr_member', 'usr_target', 'admin');
    } catch (e) {
      err = e;
    }
    assert(err !== null);
    assert.strictEqual(err.statusCode, 403);
  });

  // Test 5: Admin updates a viewer to member: 200
  assertTest('Test 05: Admin updates a viewer to member: 200', () => {
    const res = service.updateMemberRole('team_alpha', 'usr_admin', 'usr_viewer', 'member');
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.member.role, 'MEMBER');
  });

  // Test 6: Admin updates a member to viewer: 200
  assertTest('Test 06: Admin updates a member to viewer: 200', () => {
    const res = service.updateMemberRole('team_alpha', 'usr_admin', 'usr_target', 'viewer');
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.member.role, 'VIEWER');
  });

  // Test 7: Admin tries to promote member to owner: 403
  assertTest('Test 07: Admin tries to promote member to owner: 403', () => {
    let err = null;
    try {
      service.updateMemberRole('team_alpha', 'usr_admin', 'usr_target', 'owner');
    } catch (e) {
      err = e;
    }
    assert(err !== null);
    assert.strictEqual(err.statusCode, 403);
  });

  // Test 8: Admin tries to update own role: 403
  assertTest('Test 08: Admin tries to update own role: 403', () => {
    let err = null;
    try {
      service.updateMemberRole('team_alpha', 'usr_admin', 'usr_admin', 'member');
    } catch (e) {
      err = e;
    }
    assert(err !== null);
    assert.strictEqual(err.statusCode, 403);
    assert.strictEqual(err.message, 'Cannot modify your own role');
  });

  // Test 9: Owner updates a member to admin: 200
  assertTest('Test 09: Owner updates a member to admin: 200', () => {
    const res = service.updateMemberRole('team_alpha', 'usr_alice', 'usr_member', 'admin');
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.member.role, 'ADMIN');
  });

  // Test 10: Owner promotes a member to owner: 200
  assertTest('Test 10: Owner promotes a member to owner: 200', () => {
    const res = service.updateMemberRole('team_alpha', 'usr_alice', 'usr_member', 'owner');
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.member.role, 'OWNER');
  });

  // Test 11: Owner tries to update own role: 403
  assertTest('Test 11: Owner tries to update own role: 403', () => {
    let err = null;
    try {
      service.updateMemberRole('team_alpha', 'usr_alice', 'usr_alice', 'admin');
    } catch (e) {
      err = e;
    }
    assert(err !== null);
    assert.strictEqual(err.statusCode, 403);
    assert.strictEqual(err.message, 'Cannot modify your own role');
  });

  // Test 12: Any user sends role value "superadmin": 400
  assertTest('Test 12: Any user sends role value "superadmin": 400', () => {
    let err = null;
    try {
      service.updateMemberRole('team_alpha', 'usr_admin', 'usr_target', 'superadmin');
    } catch (e) {
      err = e;
    }
    assert(err !== null);
    assert.strictEqual(err.statusCode, 400);
  });

  // Test 13: Any user sends role value "": 400
  assertTest('Test 13: Any user sends role value "": 400', () => {
    let err = null;
    try {
      service.updateMemberRole('team_alpha', 'usr_admin', 'usr_target', '');
    } catch (e) {
      err = e;
    }
    assert(err !== null);
    assert.strictEqual(err.statusCode, 400);
  });
}

// ============================================================================
// PART 2: SECURITY BOUNDARY & AUDIT TRAIL VERIFICATION
// ============================================================================
log('\n--- PART 2: Security Boundaries, Audit Logging & Edge Cases ---');

{
  const { teamStore, membershipStore, auditLog } = createTestFixtures();
  const service = new TeamMembersService(teamStore, membershipStore, auditLog);

  // Test 14: Admin cannot demote team owner: 403
  assertTest('Test 14: Admin cannot demote team owner: 403', () => {
    let err = null;
    try {
      service.updateMemberRole('team_alpha', 'usr_admin', 'usr_alice', 'member');
    } catch (e) {
      err = e;
    }
    assert(err !== null);
    assert.strictEqual(err.statusCode, 403);
  });

  // Test 15: Non-existent team rejected with 404
  assertTest('Test 15: Non-existent team rejected with 404', () => {
    let err = null;
    try {
      service.updateMemberRole('team_missing', 'usr_admin', 'usr_target', 'member');
    } catch (e) {
      err = e;
    }
    assert(err !== null);
    assert.strictEqual(err.statusCode, 404);
  });

  // Test 16: Non-existent target user rejected with 404
  assertTest('Test 16: Non-existent target user rejected with 404', () => {
    let err = null;
    try {
      service.updateMemberRole('team_alpha', 'usr_admin', 'usr_ghost', 'member');
    } catch (e) {
      err = e;
    }
    assert(err !== null);
    assert.strictEqual(err.statusCode, 404);
  });

  // Test 17: Cross-tenant caller (Team Beta user) rejected with 403
  assertTest('Test 17: Cross-tenant caller rejected with 403', () => {
    let err = null;
    try {
      service.updateMemberRole('team_alpha', 'usr_charlie', 'usr_target', 'member');
    } catch (e) {
      err = e;
    }
    assert(err !== null);
    assert.strictEqual(err.statusCode, 403);
  });

  // Test 18: Unauthenticated caller (null / empty) rejected with 401
  assertTest('Test 18: Unauthenticated caller rejected with 401', () => {
    let err = null;
    try {
      service.updateMemberRole('team_alpha', null, 'usr_target', 'member');
    } catch (e) {
      err = e;
    }
    assert(err !== null);
    assert.strictEqual(err.statusCode, 401);
  });

  // Test 19: Anonymous caller rejected with 401
  assertTest('Test 19: Anonymous caller rejected with 401', () => {
    let err = null;
    try {
      service.updateMemberRole('team_alpha', 'anonymous', 'usr_target', 'member');
    } catch (e) {
      err = e;
    }
    assert(err !== null);
    assert.strictEqual(err.statusCode, 401);
  });

  // Test 20: Malformed non-string role rejected with 400
  assertTest('Test 20: Malformed non-string role rejected with 400', () => {
    let err = null;
    try {
      service.updateMemberRole('team_alpha', 'usr_admin', 'usr_target', 12345);
    } catch (e) {
      err = e;
    }
    assert(err !== null);
    assert.strictEqual(err.statusCode, 400);
  });

  // Test 21: Audit logging captures all required fields on role change
  assertTest('Test 21: Audit logging captures teamId, targetUserId, oldRole, newRole, requestingUserId', () => {
    const res = service.updateMemberRole('team_alpha', 'usr_admin', 'usr_target', 'member');
    assert.strictEqual(res.success, true);
    assert(res.audit !== undefined, 'Audit record returned in response');
    assert.strictEqual(res.audit.teamId, 'team_alpha');
    assert.strictEqual(res.audit.targetUserId, 'usr_target');
    assert.strictEqual(res.audit.oldRole, 'VIEWER');
    assert.strictEqual(res.audit.newRole, 'MEMBER');
    assert.strictEqual(res.audit.requestingUserId, 'usr_admin');
    assert(res.audit.timestamp !== undefined);

    const logs = service.getAuditLogs('team_alpha');
    assert.strictEqual(logs.length, 1);
    assert.strictEqual(logs[0].targetUserId, 'usr_target');
  });
}

// ============================================================================
// PART 3: CONTROLLER HTTP INTEGRATION & SAFE ERROR ENVELOPE
// ============================================================================
log('\n--- PART 3: Controller HTTP Integration & Envelope Verification ---');

{
  const { teamStore, membershipStore, auditLog } = createTestFixtures();
  const service = new TeamMembersService(teamStore, membershipStore, auditLog);
  const controller = new TeamMembersController(service);

  // Test 22: Controller maps 200 OK with valid JSON response
  assertTest('Test 22: Controller maps successful update to HTTP 200 with JSON body', async () => {
    const req = {
      params: { id: 'team_alpha', uid: 'usr_target' },
      user: { id: 'usr_admin' },
      body: { role: 'member' },
    };
    const res = createMockResponse();
    await controller.updateMemberRoleHandler(req, res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.member.role, 'MEMBER');
  });

  // Test 23: Controller maps 403 FORBIDDEN with SafeErrorEnvelope
  assertTest('Test 23: Controller maps unauthorized request to HTTP 403 SafeErrorEnvelope', async () => {
    const req = {
      params: { id: 'team_alpha', uid: 'usr_target' },
      user: { id: 'usr_viewer' },
      body: { role: 'admin' },
    };
    const res = createMockResponse();
    await controller.updateMemberRoleHandler(req, res);
    assert.strictEqual(res.statusCode, 403);
    assert.deepStrictEqual(res.body, {
      error: {
        code: 'FORBIDDEN',
        message: 'Insufficient permissions to modify team member roles',
      },
    });
  });

  // Test 24: Controller maps 400 BAD_REQUEST with SafeErrorEnvelope
  assertTest('Test 24: Controller maps invalid role to HTTP 400 SafeErrorEnvelope', async () => {
    const req = {
      params: { id: 'team_alpha', uid: 'usr_target' },
      user: { id: 'usr_admin' },
      body: { role: 'superadmin' },
    };
    const res = createMockResponse();
    await controller.updateMemberRoleHandler(req, res);
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.body.error.code, 'BAD_REQUEST');
  });

  // Test 25: Controller maps 401 UNAUTHORIZED when caller identity is missing
  assertTest('Test 25: Controller maps missing caller identity to HTTP 401 SafeErrorEnvelope', async () => {
    const req = {
      params: { id: 'team_alpha', uid: 'usr_target' },
      user: null,
      headers: {},
      body: { role: 'member' },
    };
    const res = createMockResponse();
    await controller.updateMemberRoleHandler(req, res);
    assert.strictEqual(res.statusCode, 401);
    assert.strictEqual(res.body.error.code, 'UNAUTHORIZED');
  });
}

// ----------------------------------------------------------------------------
// RESULTS & PERSISTENCE
// ----------------------------------------------------------------------------
log('\n================================================================================');
log(`TEST SUITE RESULTS: ${passCount} PASSED, ${failCount} FAILED, ${passCount + failCount} TOTAL`);
log('================================================================================');

fs.writeFileSync(logFile, logs.join('\n') + '\n', 'utf8');
log(`Output saved to ${logFile}`);

if (failCount > 0) {
  process.exit(1);
}
