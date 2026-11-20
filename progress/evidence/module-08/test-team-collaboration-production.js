// ============================================================================
// MODULE 08: SHIP IT — COMPREHENSIVE PRODUCTION TEST SUITE
// ============================================================================
// Evaluates:
// 1. Endpoint tests (success, 401 unauthenticated, 400 bad request, 403 forbidden, 404 not found)
// 2. Permission boundary matrix (Admin vs Member vs Viewer)
// 3. Edge cases (self-invitation, expired token, cross-tenant isolation, self-role modification)
// ============================================================================

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { TeamCollaborationEngine } = require('./team-collaboration-engine');

const logFile = path.join(__dirname, 'production-test-output.txt');
const logs = [];

function log(msg) {
  console.log(msg);
  logs.push(msg);
}

log('================================================================================');
log('MODULE 08 STEP 3: PRODUCTION REGRESSION & BOUNDARY TEST SUITE');
log(`Timestamp: ${new Date().toISOString()}`);
log('Evaluating Endpoint Invariants, Full RBAC Matrix & Critical Edge Cases');
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
// PART 1: ENDPOINT CONTRACT TESTS (Success, 401, 400, 403, 404)
// ----------------------------------------------------------------------------
log('--- PART 1: Endpoint Invariant Tests ---');

{
  const engine = new TeamCollaborationEngine();
  const owner = 'usr_owner';
  const member = 'usr_member';

  // 1. POST /teams
  assertTest('E1.1: POST /teams creates team with 201 equivalent and owner role', () => {
    const team = engine.createTeam(owner, 'Platform Engineering');
    assert(team.id.startsWith('team_'));
    assert.strictEqual(team.ownerId, owner);
    const m = engine.memberships.get(`${team.id}:${owner}`);
    assert.strictEqual(m.role, 'OWNER');
  });

  assertTest('E1.2: POST /teams rejects empty name with BAD_REQUEST (400)', () => {
    let err = null;
    try {
      engine.createTeam(owner, '   ');
    } catch (e) {
      err = e;
    }
    assert(err !== null);
    assert.strictEqual(err.statusCode, 400);
  });

  assertTest('E1.3: POST /teams rejects unauthenticated caller with UNAUTHORIZED (401)', () => {
    let err = null;
    try {
      engine.createTeam(null, 'SecOps');
    } catch (e) {
      err = e;
    }
    assert(err !== null);
    assert.strictEqual(err.statusCode, 401);
  });

  // 2. POST /teams/:id/invitations
  let teamId = engine.createTeam(owner, 'Core Services').id;

  assertTest('E2.1: POST /teams/:id/invitations dispatches pending invitation', () => {
    const inv = engine.createInvitation(teamId, owner, 'dev@knack.io', 'member');
    assert(inv.token.startsWith('inv_tok_'));
    assert.strictEqual(inv.status, 'PENDING');
  });

  assertTest('E2.2: POST /teams/:id/invitations rejects invalid email with BAD_REQUEST (400)', () => {
    let err = null;
    try {
      engine.createInvitation(teamId, owner, 'not-an-email', 'member');
    } catch (e) {
      err = e;
    }
    assert(err !== null);
    assert.strictEqual(err.statusCode, 400);
  });

  assertTest('E2.3: POST /teams/:id/invitations rejects non-existent team with NOT_FOUND (404)', () => {
    let err = null;
    try {
      engine.createInvitation('team_non_existent', owner, 'dev@knack.io', 'member');
    } catch (e) {
      err = e;
    }
    assert(err !== null);
    assert.strictEqual(err.statusCode, 404);
  });

  // 3. POST /invitations/:token/accept
  const validInv = engine.createInvitation(teamId, owner, 'newhire@knack.io', 'viewer');

  assertTest('E3.1: Accepting invitation with valid token creates membership', () => {
    const res = engine.acceptInvitation(validInv.token, 'usr_newhire');
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.membership.role, 'VIEWER');
  });

  assertTest('E3.2: Accepting invalid token rejected with NOT_FOUND (404)', () => {
    let err = null;
    try {
      engine.acceptInvitation('invalid_token_xyz', 'usr_newhire');
    } catch (e) {
      err = e;
    }
    assert(err !== null);
    assert.strictEqual(err.statusCode, 404);
  });
}

// ----------------------------------------------------------------------------
// PART 2: THE FULL PERMISSION BOUNDARY MATRIX (Admin, Member, Viewer)
// ----------------------------------------------------------------------------
log('\n--- PART 2: Permission Boundary Matrix ---');

{
  const engine = new TeamCollaborationEngine();
  const owner = 'usr_alice';
  const admin = 'usr_admin';
  const member = 'usr_member';
  const viewer = 'usr_viewer';
  const target = 'usr_target';

  const team = engine.createTeam(owner, 'Security Team');
  const teamId = team.id;

  // Setup memberships
  engine.memberships.set(`${teamId}:${admin}`, { teamId, userId: admin, role: 'ADMIN' });
  engine.memberships.set(`${teamId}:${member}`, { teamId, userId: member, role: 'MEMBER' });
  engine.memberships.set(`${teamId}:${viewer}`, { teamId, userId: viewer, role: 'VIEWER' });
  engine.memberships.set(`${teamId}:${target}`, { teamId, userId: target, role: 'MEMBER' });

  const task = engine.createTask(teamId, admin, 'Quarterly Audit');

  // Matrix Row 1: ADMIN Capabilities
  assertTest('P1.1: ADMIN can invite new users (ALLOWED)', () => {
    const inv = engine.createInvitation(teamId, admin, 'consultant@sec.io', 'viewer');
    assert.strictEqual(inv.status, 'PENDING');
  });

  assertTest('P1.2: ADMIN can change member role (ALLOWED)', () => {
    const res = engine.updateMemberRole(teamId, admin, target, 'viewer');
    assert.strictEqual(res.member.role, 'VIEWER');
  });

  assertTest('P1.3: ADMIN can inspect audit logs (ALLOWED)', () => {
    const logs = engine.getAuditLog(teamId, admin);
    assert(Array.isArray(logs));
  });

  assertTest('P1.4: ADMIN CANNOT promote another user to OWNER (403 FORBIDDEN)', () => {
    let err = null;
    try {
      engine.updateMemberRole(teamId, admin, target, 'owner');
    } catch (e) {
      err = e;
    }
    assert(err !== null);
    assert.strictEqual(err.statusCode, 403);
  });

  assertTest('P1.5: ADMIN CANNOT modify their own role (403 FORBIDDEN)', () => {
    let err = null;
    try {
      engine.updateMemberRole(teamId, admin, admin, 'viewer');
    } catch (e) {
      err = e;
    }
    assert(err !== null);
    assert.strictEqual(err.statusCode, 403);
  });

  // Matrix Row 2: MEMBER Capabilities & Bounds
  assertTest('P2.1: MEMBER can post comments (ALLOWED)', () => {
    const c = engine.addComment(teamId, task.id, member, 'Working on task checklist');
    assert.strictEqual(c.authorId, member);
  });

  assertTest('P2.2: MEMBER can view activity feed (ALLOWED)', () => {
    const feed = engine.getActivityFeed(teamId, member);
    assert(Array.isArray(feed));
  });

  assertTest('P2.3: MEMBER CANNOT invite new users (403 FORBIDDEN)', () => {
    let err = null;
    try {
      engine.createInvitation(teamId, member, 'friend@sec.io', 'member');
    } catch (e) {
      err = e;
    }
    assert(err !== null);
    assert.strictEqual(err.statusCode, 403);
  });

  assertTest('P2.4: MEMBER CANNOT change roles (403 FORBIDDEN)', () => {
    let err = null;
    try {
      engine.updateMemberRole(teamId, member, target, 'admin');
    } catch (e) {
      err = e;
    }
    assert(err !== null);
    assert.strictEqual(err.statusCode, 403);
  });

  assertTest('P2.5: MEMBER CANNOT access audit logs (403 FORBIDDEN)', () => {
    let err = null;
    try {
      engine.getAuditLog(teamId, member);
    } catch (e) {
      err = e;
    }
    assert(err !== null);
    assert.strictEqual(err.statusCode, 403);
  });

  // Matrix Row 3: VIEWER Capabilities & Bounds
  assertTest('P3.1: VIEWER can view activity feed (ALLOWED)', () => {
    const feed = engine.getActivityFeed(teamId, viewer);
    assert(Array.isArray(feed));
  });

  assertTest('P3.2: VIEWER CANNOT post comments (403 FORBIDDEN)', () => {
    let err = null;
    try {
      engine.addComment(teamId, task.id, viewer, 'Unauthorized viewer comment');
    } catch (e) {
      err = e;
    }
    assert(err !== null);
    assert.strictEqual(err.statusCode, 403);
  });

  assertTest('P3.3: VIEWER CANNOT invite new users (403 FORBIDDEN)', () => {
    let err = null;
    try {
      engine.createInvitation(teamId, viewer, 'test@sec.io', 'viewer');
    } catch (e) {
      err = e;
    }
    assert(err !== null);
    assert.strictEqual(err.statusCode, 403);
  });

  assertTest('P3.4: VIEWER CANNOT change roles (403 FORBIDDEN)', () => {
    let err = null;
    try {
      engine.updateMemberRole(teamId, viewer, viewer, 'admin');
    } catch (e) {
      err = e;
    }
    assert(err !== null);
    assert.strictEqual(err.statusCode, 403);
  });
}

// ----------------------------------------------------------------------------
// PART 3: CRITICAL EDGE CASES (Module 04 & 07 Findings)
// ----------------------------------------------------------------------------
log('\n--- PART 3: Critical Edge Cases & Adversarial Boundary Tests ---');

{
  const engine = new TeamCollaborationEngine();
  const owner = 'usr_alice';
  const teamAlpha = engine.createTeam(owner, 'Alpha Tenant');
  const teamBeta = engine.createTeam('usr_charlie', 'Beta Tenant');

  // Edge Case 1: Expired Invitation Acceptance
  const expiredInv = engine.createInvitation(teamAlpha.id, owner, 'expired@alpha.io', 'member');
  expiredInv.expiresAt = new Date(Date.now() - 1000).toISOString(); // Expired 1 second ago

  assertTest('Edge 1: Acceptance of expired invitation rejected with EXPIRED_INVITATION (400)', () => {
    let err = null;
    try {
      engine.acceptInvitation(expiredInv.token, 'usr_late');
    } catch (e) {
      err = e;
    }
    assert(err !== null);
    assert.strictEqual(err.statusCode, 400);
    assert.strictEqual(err.code, 'EXPIRED_INVITATION');
  });

  // Edge Case 2: Cross-Tenant Intrusion on Tasks & Comments
  const taskAlpha = engine.createTask(teamAlpha.id, owner, 'Alpha Proprietary Task');

  assertTest('Edge 2.1: Member of Team Beta blocked from commenting on Team Alpha task (403)', () => {
    let err = null;
    try {
      engine.addComment(teamAlpha.id, taskAlpha.id, 'usr_charlie', 'Intruder comment');
    } catch (e) {
      err = e;
    }
    assert(err !== null);
    assert.strictEqual(err.statusCode, 403);
  });

  assertTest('Edge 2.2: Member of Team Beta blocked from reading Team Alpha comments (403)', () => {
    let err = null;
    try {
      engine.getComments(teamAlpha.id, taskAlpha.id, 'usr_charlie');
    } catch (e) {
      err = e;
    }
    assert(err !== null);
    assert.strictEqual(err.statusCode, 403);
  });

  // Edge Case 3: Arbitrary Role Injections
  assertTest('Edge 3: Assigning arbitrary role "superadmin" rejected with BAD_REQUEST (400)', () => {
    let err = null;
    try {
      engine.updateMemberRole(teamAlpha.id, owner, owner, 'superadmin');
    } catch (e) {
      err = e;
    }
    assert(err !== null);
    assert.strictEqual(err.statusCode, 400);
  });

  // Edge Case 4: Non-Existent Resources
  assertTest('Edge 4: Commenting on non-existent task rejected with NOT_FOUND (404)', () => {
    let err = null;
    try {
      engine.addComment(teamAlpha.id, 'tsk_does_not_exist', owner, 'Ghost comment');
    } catch (e) {
      err = e;
    }
    assert(err !== null);
    assert.strictEqual(err.statusCode, 404);
  });
}

// ----------------------------------------------------------------------------
// RESULTS & LOGGING
// ----------------------------------------------------------------------------
log('\n================================================================================');
log(`PRODUCTION TEST RESULTS: ${passCount} PASSED, ${failCount} FAILED, ${passCount + failCount} TOTAL`);
log('================================================================================');

fs.writeFileSync(logFile, logs.join('\n') + '\n', 'utf8');
log(`Output saved to ${logFile}`);

if (failCount > 0) {
  process.exit(1);
}
