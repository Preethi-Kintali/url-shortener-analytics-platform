// ============================================================================
// MODULE 08: SHIP IT — CAPSTONE END-TO-END INTEGRATION TEST
// ============================================================================
// Exercises the complete 6-step user journey across the unified collaboration system:
// 1. User A creates a team.
// 2. User A invites User B to the team as a member.
// 3. User B accepts the invitation.
// 4. User B comments on a task in the team with @mention of User A.
// 5. User A checks activity feed and sees User B's comment.
// 6. Admin checks audit log and verifies all 4 milestone actions recorded.
// ============================================================================

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { TeamCollaborationEngine } = require('./team-collaboration-engine');

const logFile = path.join(__dirname, 'integration-test-output.txt');
const logs = [];

function log(msg) {
  console.log(msg);
  logs.push(msg);
}

log('================================================================================');
log('MODULE 08 STEP 3: CAPSTONE END-TO-END INTEGRATION TEST');
log(`Timestamp: ${new Date().toISOString()}`);
log('Evaluating 6-Stage User Collaboration Lifecycle with Data Threading');
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
// TEST EXECUTION
// ----------------------------------------------------------------------------
{
  const engine = new TeamCollaborationEngine();

  // Test Identities
  const userA = 'usr_alice';
  const userB = 'usr_bob';
  const userC = 'usr_charlie'; // Cross-team outsider

  let teamId = null;
  let invitationToken = null;
  let taskId = null;
  let commentId = null;

  // --------------------------------------------------------------------------
  // STAGE 1: User A Creates Team
  // --------------------------------------------------------------------------
  log('--- STAGE 1: Team Creation ---');
  assertTest('Stage 1.1: User A creates "Engineering Core" team', () => {
    const team = engine.createTeam(userA, 'Engineering Core');
    assert(team.id !== undefined);
    assert.strictEqual(team.name, 'Engineering Core');
    assert.strictEqual(team.ownerId, userA);
    teamId = team.id;
  });

  assertTest('Stage 1.2: User A is registered as team OWNER', () => {
    const membership = engine.memberships.get(`${teamId}:${userA}`);
    assert(membership !== undefined);
    assert.strictEqual(membership.role, 'OWNER');
  });

  // --------------------------------------------------------------------------
  // STAGE 2: User A Invites User B
  // --------------------------------------------------------------------------
  log('\n--- STAGE 2: Invitation Dispatch ---');
  assertTest('Stage 2.1: User A invites User B (bob@knack.io) with role MEMBER', () => {
    const invitation = engine.createInvitation(teamId, userA, 'bob@knack.io', 'member');
    assert(invitation.token !== undefined);
    assert.strictEqual(invitation.email, 'bob@knack.io');
    assert.strictEqual(invitation.role, 'MEMBER');
    assert.strictEqual(invitation.status, 'PENDING');
    invitationToken = invitation.token;
  });

  assertTest('Stage 2.2: Duplicate invitation to same email is rejected with CONFLICT (409)', () => {
    let err = null;
    try {
      engine.createInvitation(teamId, userA, 'bob@knack.io', 'member');
    } catch (e) {
      err = e;
    }
    assert(err !== null);
    assert.strictEqual(err.statusCode, 409);
  });

  // --------------------------------------------------------------------------
  // STAGE 3: User B Accepts Invitation
  // --------------------------------------------------------------------------
  log('\n--- STAGE 3: Invitation Acceptance ---');
  assertTest('Stage 3.1: User B accepts invitation using valid token', () => {
    const res = engine.acceptInvitation(invitationToken, userB);
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.membership.userId, userB);
    assert.strictEqual(res.membership.role, 'MEMBER');
  });

  assertTest('Stage 3.2: User B is now a verified team member', () => {
    const membership = engine.memberships.get(`${teamId}:${userB}`);
    assert(membership !== undefined);
    assert.strictEqual(membership.role, 'MEMBER');
  });

  assertTest('Stage 3.3: Re-accepting already accepted invitation is rejected (400)', () => {
    let err = null;
    try {
      engine.acceptInvitation(invitationToken, userB);
    } catch (e) {
      err = e;
    }
    assert(err !== null);
    assert.strictEqual(err.statusCode, 400);
  });

  // --------------------------------------------------------------------------
  // STAGE 4: Task Creation & Comment with @mention
  // --------------------------------------------------------------------------
  log('\n--- STAGE 4: Task & Comment with @Mention ---');
  assertTest('Stage 4.1: Task "Setup CI Pipeline" created in team', () => {
    const task = engine.createTask(teamId, userA, 'Setup CI Pipeline');
    assert(task.id !== undefined);
    assert.strictEqual(task.teamId, teamId);
    taskId = task.id;
  });

  assertTest('Stage 4.2: User B posts comment with @mention of User A', () => {
    const comment = engine.addComment(
      teamId,
      taskId,
      userB,
      'Hey @usr_alice, the integration tests are ready for review!'
    );
    assert(comment.id !== undefined);
    assert.strictEqual(comment.authorId, userB);
    assert.deepStrictEqual(comment.mentions, ['usr_alice']);
    commentId = comment.id;
  });

  assertTest('Stage 4.3: User A retrieves comments on task', () => {
    const comments = engine.getComments(teamId, taskId, userA);
    assert.strictEqual(comments.length, 1);
    assert.strictEqual(comments[0].id, commentId);
    assert.strictEqual(comments[0].authorId, userB);
  });

  assertTest('Stage 4.4: Outsider User C blocked from accessing comments with FORBIDDEN (403)', () => {
    let err = null;
    try {
      engine.getComments(teamId, taskId, userC);
    } catch (e) {
      err = e;
    }
    assert(err !== null);
    assert.strictEqual(err.statusCode, 403);
  });

  // --------------------------------------------------------------------------
  // STAGE 5: Activity Feed Verification
  // --------------------------------------------------------------------------
  log('\n--- STAGE 5: Real-Time Activity Feed ---');
  assertTest('Stage 5.1: User A inspects activity feed and observes comment & member events', () => {
    const feed = engine.getActivityFeed(teamId, userA);
    assert(feed.length >= 2, 'Feed contains joined and comment events');

    const commentEvent = feed.find(e => e.type === 'comment.created');
    assert(commentEvent !== undefined, 'Comment event present in feed');
    assert.strictEqual(commentEvent.actorId, userB);
    assert.strictEqual(commentEvent.payload.commentId, commentId);
  });

  assertTest('Stage 5.2: Feed items have strictly monotonic sequence numbers', () => {
    const feed = engine.getActivityFeed(teamId, userA);
    for (let i = 0; i < feed.length; i++) {
      assert.strictEqual(feed[i].sequence, i + 1);
    }
  });

  // --------------------------------------------------------------------------
  // STAGE 6: Complete Audit Log Verification
  // --------------------------------------------------------------------------
  log('\n--- STAGE 6: Audit Trail Verification ---');
  assertTest('Stage 6.1: Admin User A retrieves audit logs for team', () => {
    const logs = engine.getAuditLog(teamId, userA);
    assert(logs.length >= 4, 'Contains at least 4 audit events');

    const actions = logs.map(l => l.action);
    assert(actions.includes('team.created'), 'Audit contains team.created');
    assert(actions.includes('invitation.sent'), 'Audit contains invitation.sent');
    assert(actions.includes('invitation.accepted'), 'Audit contains invitation.accepted');
    assert(actions.includes('comment.created'), 'Audit contains comment.created');
  });

  assertTest('Stage 6.2: Ordinary Member User B blocked from accessing audit log (403)', () => {
    let err = null;
    try {
      engine.getAuditLog(teamId, userB);
    } catch (e) {
      err = e;
    }
    assert(err !== null);
    assert.strictEqual(err.statusCode, 403);
  });

  // --------------------------------------------------------------------------
  // BONUS: Role Transition Lifecycle Verification
  // --------------------------------------------------------------------------
  log('\n--- STAGE 7: Role Transition & Audit Trace ---');
  assertTest('Stage 7.1: User A promotes User B to ADMIN', () => {
    const res = engine.updateMemberRole(teamId, userA, userB, 'admin');
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.member.role, 'ADMIN');
  });

  assertTest('Stage 7.2: Newly promoted Admin User B can now inspect audit log', () => {
    const logs = engine.getAuditLog(teamId, userB);
    assert(logs.length >= 4);
  });

  assertTest('Stage 7.3: User B blocked from modifying their own role (403)', () => {
    let err = null;
    try {
      engine.updateMemberRole(teamId, userB, userB, 'viewer');
    } catch (e) {
      err = e;
    }
    assert(err !== null);
    assert.strictEqual(err.statusCode, 403);
  });
}

// ----------------------------------------------------------------------------
// RESULTS & LOGGING
// ----------------------------------------------------------------------------
log('\n================================================================================');
log(`INTEGRATION TEST RESULTS: ${passCount} PASSED, ${failCount} FAILED, ${passCount + failCount} TOTAL`);
log('================================================================================');

fs.writeFileSync(logFile, logs.join('\n') + '\n', 'utf8');
log(`Output saved to ${logFile}`);

if (failCount > 0) {
  process.exit(1);
}
