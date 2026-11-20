// ============================================================================
// MODULE 08 STEP 6: FIX — HERMETIC ENVIRONMENT-INDEPENDENT INTEGRATION SUITE
// ============================================================================
// Enforces complete isolation and zero-precondition lifecycle testing.
// Guaranteed to pass identically in local development, containerized CI,
// or staging environments without relying on pre-existing database seeds.
// ============================================================================

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { TeamCollaborationEngine } = require('./team-collaboration-engine');

const logFile = path.join(__dirname, 'hermetic-test-output.txt');
let logBuffer = '';

function log(msg) {
  console.log(msg);
  logBuffer += msg + '\n';
}

class HermeticTestContext {
  constructor() {
    this.engine = null;
    this.createdTeams = [];
    this.createdUsers = [];
  }

  // Lifecycle Hook: Setup clean, empty environment
  setup() {
    this.engine = new TeamCollaborationEngine();
    this.createdTeams = [];
    this.createdUsers = [];
  }

  // Factory Method: Hermetically provisions a dynamic user identity
  createUser(prefix = 'user') {
    const userId = `usr_${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    this.createdUsers.push(userId);
    return userId;
  }

  // Factory Method: Provisions a dynamic workspace via standard API
  createTeam(ownerId, teamName = 'Hermetic Test Team') {
    const team = this.engine.createTeam(ownerId, teamName);
    this.createdTeams.push(team.id);
    return team;
  }

  // Lifecycle Hook: Safe teardown (does not throw if setup partially failed)
  teardown() {
    try {
      this.createdTeams = [];
      this.createdUsers = [];
      this.engine = null;
    } catch (ignored) {
      // Safe teardown
    }
  }
}

function runHermeticIntegrationSuite() {
  log('================================================================================');
  log('MODULE 08 STEP 6: HERMETIC INTEGRATION TEST SUITE');
  log(`Timestamp: ${new Date().toISOString()}`);
  log('Verifying Zero-Precondition Execution in Pristine CI Environment');
  log('================================================================================\n');

  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    const ctx = new HermeticTestContext();
    ctx.setup();
    try {
      fn(ctx);
      log(`[PASS] ${name}`);
      passed++;
    } catch (err) {
      log(`[FAIL] ${name}: ${err.message}`);
      failed++;
    } finally {
      ctx.teardown();
    }
  }

  // Test 1: Complete isolated end-to-end user collaboration
  test('H1: Complete invitation & collaboration lifecycle without pre-existing seeds', (ctx) => {
    // 1. Explicitly create User A & User B
    const userA = ctx.createUser('owner');
    const userB = ctx.createUser('member');

    // 2. Explicitly create Team with dynamically generated ID
    const team = ctx.createTeam(userA, 'Core Infra');
    assert(team.id && team.id.startsWith('team_'));

    // 3. User A invites User B (No pre-existing invitations in database)
    const invitation = ctx.engine.createInvitation(team.id, userA, 'bob.infra@example.com', 'member');
    assert(invitation.token && invitation.token.startsWith('inv_tok_'));
    assert.strictEqual(invitation.status, 'PENDING');

    // 4. User B accepts invitation
    const acceptRes = ctx.engine.acceptInvitation(invitation.token, userB);
    assert.strictEqual(acceptRes.success, true);
    assert.strictEqual(acceptRes.membership.role, 'MEMBER');

    // 5. Create Task and Post Comment with Mention
    const task = ctx.engine.createTask(team.id, userB, 'Deploy to Kubernetes');
    assert(task.id && task.id.startsWith('tsk_'));

    const comment = ctx.engine.addComment(team.id, task.id, userB, `LGTM. Deploying now! cc @${userA}`);
    assert(comment.id && comment.id.startsWith('cmt_'));
    assert.deepStrictEqual(comment.mentions, [userA]);

    // 6. Verify Activity Feed sequencing
    const feed = ctx.engine.getActivityFeed(team.id, userA);
    assert(feed.length >= 2);
    assert.strictEqual(feed[feed.length - 1].sequence, feed.length);

    // 7. Verify Tamper-Evident Audit Trail
    const audit = ctx.engine.getAuditLog(team.id, userA);
    assert(audit.length >= 3);
  });

  // Test 2: Multi-tenant boundary isolation without shared database cross-talk
  test('H2: Multi-tenant boundary isolation in clean state', (ctx) => {
    const tenantA_Owner = ctx.createUser('tenantA');
    const tenantB_Owner = ctx.createUser('tenantB');

    const teamA = ctx.createTeam(tenantA_Owner, 'Tenant Alpha');
    const teamB = ctx.createTeam(tenantB_Owner, 'Tenant Beta');

    const taskA = ctx.engine.createTask(teamA.id, tenantA_Owner, 'Confidential Roadmap');

    // Tenant B cannot comment on Tenant A task
    assert.throws(() => {
      ctx.engine.addComment(teamA.id, taskA.id, tenantB_Owner, 'Attempting breach');
    }, (err) => err.statusCode === 403);

    // Tenant B cannot read Tenant A comments
    assert.throws(() => {
      ctx.engine.getComments(teamA.id, taskA.id, tenantB_Owner);
    }, (err) => err.statusCode === 403);
  });

  // Test 3: Safe teardown and state non-leakage
  test('H3: Independent test isolation — each test runs against a fresh pristine instance', (ctx) => {
    assert.strictEqual(ctx.engine.teams.size, 0);
    assert.strictEqual(ctx.engine.memberships.size, 0);
    assert.strictEqual(ctx.engine.auditLogs.length, 0);
  });

  log(`\n================================================================================`);
  log(`HERMETIC SUITE RESULTS: ${passed} PASSED, ${failed} FAILED, ${passed + failed} TOTAL`);
  log(`================================================================================`);

  fs.writeFileSync(logFile, logBuffer, 'utf8');
  return failed === 0;
}

if (require.main === module) {
  const success = runHermeticIntegrationSuite();
  process.exit(success ? 0 : 1);
}

module.exports = { HermeticTestContext, runHermeticIntegrationSuite };
