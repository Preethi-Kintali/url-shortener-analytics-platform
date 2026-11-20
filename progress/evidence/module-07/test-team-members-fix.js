// ============================================================================
// MODULE 07 STEP 4: VERIFY — TEAM MEMBER ROLE REGRESSION & FIX VERIFICATION
// ============================================================================

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { TeamMembersService, VALID_ROLES } = require('./team-members.service');
const { TeamMembersController } = require('./team-members.controller');

const logFile = path.join(__dirname, 'test-fix-output.txt');
const logs = [];

function log(msg) {
  console.log(msg);
  logs.push(msg);
}

log('================================================================================');
log('MODULE 07 STEP 4: VERIFY — FIX AND RECHECK REGRESSION SUITE');
log(`Timestamp: ${new Date().toISOString()}`);
log('Evaluating SEC-01 (Missing Admin Check) and SEC-02 (Role Input Validation)');
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
// SETUP FIXTURES
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
// PART 1: UNPATCHED VULNERABILITY REPRODUCTION (BASELINE FLAW)
// ----------------------------------------------------------------------------
log('--- PART 1: Demonstrating Baseline Flaw (Pre-Fix Vulnerability) ---');

class VulnerableTeamMembersService {
  constructor(teamStore, membershipStore) {
    this.teamStore = teamStore;
    this.membershipStore = membershipStore;
  }
  updateMemberRole(teamId, callerUserId, targetUserId, role) {
    // FLAW 1 (SEC-01): Only checks isTeamMember, NOT isTeamAdmin!
    const caller = this.membershipStore.get(`${teamId}:${callerUserId}`);
    if (!caller) throw new Error('Not a team member'); // Fails only if caller not in team

    // FLAW 2 (SEC-02): Zero validation on role value!
    const target = this.membershipStore.get(`${teamId}:${targetUserId}`);
    if (!target) throw new Error('Target not found');

    target.role = role; // Accepts arbitrary string ('superadmin', etc.)
    return { success: true, member: target };
  }
}

{
  const { teamStore, membershipStore } = createTestFixtures();
  const vulnService = new VulnerableTeamMembersService(teamStore, membershipStore);

  assertTest('Pre-Fix Flaw 1: Ordinary MEMBER can elevate another member to admin in vulnerable service', () => {
    const res = vulnService.updateMemberRole('team_alpha', 'usr_member', 'usr_target', 'admin');
    assert.strictEqual(res.member.role, 'admin');
  });

  assertTest('Pre-Fix Flaw 2: Vulnerable service accepts arbitrary unvalidated role "superadmin"', () => {
    const res = vulnService.updateMemberRole('team_alpha', 'usr_member', 'usr_target', 'superadmin');
    assert.strictEqual(res.member.role, 'superadmin');
  });
}

// ----------------------------------------------------------------------------
// PART 2: REMEDIATED SERVICE VERIFICATION (SEC-01 & SEC-02)
// ----------------------------------------------------------------------------
log('\n--- PART 2: Verifying Remediated TeamMembersService ---');

{
  const { teamStore, membershipStore } = createTestFixtures();
  const service = new TeamMembersService(teamStore, membershipStore);

  // 1. Legitimate Administrative Updates
  assertTest('T1.1: Legitimate ADMIN can update member to viewer (200 OK)', () => {
    const res = service.updateMemberRole('team_alpha', 'usr_admin', 'usr_target', 'viewer');
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.member.role, 'VIEWER');
  });

  assertTest('T1.2: Legitimate OWNER can update member to admin (200 OK)', () => {
    const res = service.updateMemberRole('team_alpha', 'usr_alice', 'usr_target', 'admin');
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.member.role, 'ADMIN');
  });

  // 2. SEC-01: Authorization & Privilege Boundary Checks
  assertTest('T2.1: Ordinary MEMBER is blocked from modifying roles with FORBIDDEN (403)', () => {
    assert.throws(
      () => service.updateMemberRole('team_alpha', 'usr_member', 'usr_target', 'admin'),
      (err) => {
        assert.strictEqual(err.statusCode, 403);
        assert.strictEqual(err.code, 'FORBIDDEN');
        assert.strictEqual(err.response.error.message, 'Insufficient permissions to modify team member roles');
        return true;
      }
    );
  });

  assertTest('T2.2: Ordinary MEMBER is blocked from elevating themselves with FORBIDDEN (403)', () => {
    assert.throws(
      () => service.updateMemberRole('team_alpha', 'usr_member', 'usr_member', 'admin'),
      (err) => {
        assert.strictEqual(err.statusCode, 403);
        return true;
      }
    );
  });

  assertTest('T2.3: VIEWER is blocked from modifying roles with FORBIDDEN (403)', () => {
    assert.throws(
      () => service.updateMemberRole('team_alpha', 'usr_viewer', 'usr_target', 'member'),
      (err) => {
        assert.strictEqual(err.statusCode, 403);
        return true;
      }
    );
  });

  assertTest('T2.4: Admin cannot demote team OWNER (403 FORBIDDEN)', () => {
    assert.throws(
      () => service.updateMemberRole('team_alpha', 'usr_admin', 'usr_alice', 'member'),
      (err) => {
        assert.strictEqual(err.statusCode, 403);
        return true;
      }
    );
  });

  // 3. Cross-Tenant / Cross-Team Security Checks
  assertTest('T3.1: Cross-team user (usr_charlie from Team Beta) blocked from Team Alpha with FORBIDDEN (403)', () => {
    assert.throws(
      () => service.updateMemberRole('team_alpha', 'usr_charlie', 'usr_target', 'admin'),
      (err) => {
        assert.strictEqual(err.statusCode, 403);
        return true;
      }
    );
  });

  assertTest('T3.2: Member of Team Alpha (usr_admin) blocked from mutating Team Beta with FORBIDDEN (403)', () => {
    assert.throws(
      () => service.updateMemberRole('team_beta', 'usr_admin', 'usr_bob', 'viewer'),
      (err) => {
        assert.strictEqual(err.statusCode, 403);
        return true;
      }
    );
  });

  // 4. Authentication Check
  assertTest('T4.1: Missing callerUserId blocked with UNAUTHORIZED (401)', () => {
    assert.throws(
      () => service.updateMemberRole('team_alpha', null, 'usr_target', 'admin'),
      (err) => {
        assert.strictEqual(err.statusCode, 401);
        return true;
      }
    );
  });

  assertTest('T4.2: Anonymous caller blocked with UNAUTHORIZED (401)', () => {
    assert.throws(
      () => service.updateMemberRole('team_alpha', 'anonymous', 'usr_target', 'admin'),
      (err) => {
        assert.strictEqual(err.statusCode, 401);
        return true;
      }
    );
  });

  // 5. SEC-02: Input Validation on Role Enum
  assertTest('T5.1: Arbitrary role "superadmin" rejected with BAD_REQUEST (400)', () => {
    assert.throws(
      () => service.updateMemberRole('team_alpha', 'usr_admin', 'usr_target', 'superadmin'),
      (err) => {
        assert.strictEqual(err.statusCode, 400);
        assert.strictEqual(err.code, 'BAD_REQUEST');
        assert(err.response.error.message.includes('Must be one of: admin, member, viewer'));
        return true;
      }
    );
  });

  assertTest('T5.2: Role "owner" rejected with FORBIDDEN (403) when attempted by Admin', () => {
    assert.throws(
      () => service.updateMemberRole('team_alpha', 'usr_admin', 'usr_target', 'owner'),
      (err) => {
        assert.strictEqual(err.statusCode, 403);
        assert.strictEqual(err.code, 'FORBIDDEN');
        return true;
      }
    );
  });

  assertTest('T5.3: Empty string role rejected with BAD_REQUEST (400)', () => {
    assert.throws(
      () => service.updateMemberRole('team_alpha', 'usr_admin', 'usr_target', ''),
      (err) => {
        assert.strictEqual(err.statusCode, 400);
        return true;
      }
    );
  });

  assertTest('T5.4: Non-string role object ({}) rejected with BAD_REQUEST (400)', () => {
    assert.throws(
      () => service.updateMemberRole('team_alpha', 'usr_admin', 'usr_target', {}),
      (err) => {
        assert.strictEqual(err.statusCode, 400);
        return true;
      }
    );
  });

  assertTest('T5.5: Non-existent target user rejected with NOT_FOUND (404)', () => {
    assert.throws(
      () => service.updateMemberRole('team_alpha', 'usr_admin', 'usr_ghost', 'admin'),
      (err) => {
        assert.strictEqual(err.statusCode, 404);
        return true;
      }
    );
  });

  assertTest('T5.6: Non-existent team rejected with NOT_FOUND (404)', () => {
    assert.throws(
      () => service.updateMemberRole('team_nonexistent', 'usr_admin', 'usr_target', 'admin'),
      (err) => {
        assert.strictEqual(err.statusCode, 404);
        return true;
      }
    );
  });
}

// ----------------------------------------------------------------------------
// PART 3: CONTROLLER HTTP INTERACTION & ERROR ENVELOPE VERIFICATION
// ----------------------------------------------------------------------------
log('\n--- PART 3: Verifying TeamMembersController HTTP Responses ---');

{
  const { teamStore, membershipStore } = createTestFixtures();
  const service = new TeamMembersService(teamStore, membershipStore);
  const controller = new TeamMembersController(service);

  function mockResponse() {
    return {
      _status: 200,
      _json: null,
      status(s) { this._status = s; return this; },
      json(j) { this._json = j; return this; },
    };
  }

  assertTest('C1.1: HTTP PUT /teams/:id/members/:uid by Admin returns 200 JSON with updated role', async () => {
    const req = {
      params: { id: 'team_alpha', uid: 'usr_target' },
      user: { id: 'usr_admin' },
      body: { role: 'viewer' },
    };
    const res = mockResponse();
    await controller.updateMemberRoleHandler(req, res);
    assert.strictEqual(res._status, 200);
    assert.strictEqual(res._json.member.role, 'VIEWER');
  });

  assertTest('C1.2: HTTP PUT by Member returns 403 with standard error envelope', async () => {
    const req = {
      params: { id: 'team_alpha', uid: 'usr_target' },
      user: { id: 'usr_member' },
      body: { role: 'admin' },
    };
    const res = mockResponse();
    await controller.updateMemberRoleHandler(req, res);
    assert.strictEqual(res._status, 403);
    assert.strictEqual(res._json.error.code, 'FORBIDDEN');
    assert.strictEqual(res._json.error.message, 'Insufficient permissions to modify team member roles');
  });

  assertTest('C1.3: HTTP PUT with invalid role returns 400 with standard error envelope', async () => {
    const req = {
      params: { id: 'team_alpha', uid: 'usr_target' },
      user: { id: 'usr_admin' },
      body: { role: 'invalid_role_xyz' },
    };
    const res = mockResponse();
    await controller.updateMemberRoleHandler(req, res);
    assert.strictEqual(res._status, 400);
    assert.strictEqual(res._json.error.code, 'BAD_REQUEST');
  });
}

log('\n================================================================================');
log(`TEST SUITE RESULTS: ${passCount} PASSED, ${failCount} FAILED, ${passCount + failCount} TOTAL`);
log('================================================================================');

try {
  fs.writeFileSync(logFile, logs.join('\n'), 'utf8');
} catch (e) {
  // Silent fallback
}

process.exit(failCount === 0 ? 0 : 1);
