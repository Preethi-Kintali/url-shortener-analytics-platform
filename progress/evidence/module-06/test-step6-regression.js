const fs = require('fs');
const path = require('path');

const logFile = path.resolve(__dirname, 'fix-regression-test-output.txt');
try {
  fs.writeFileSync(logFile, '', 'utf8');
} catch (e) {}

function log(msg) {
  console.log(msg);
  try {
    fs.appendFileSync(logFile, msg + '\n', 'utf8');
  } catch (e) {}
}

const { EventBus, EventNames, ResourceTypes } = require('./interface-contracts');
const { CommentsService } = require('./agent-1-comments/comments.service');
const { MentionParser } = require('./agent-2-mentions/mention-parser');
const { MentionNotificationService } = require('./agent-2-mentions/mention-notification.service');
const { AuditService } = require('./agent-3-audit/audit.service');
const { createAuditMiddleware } = require('./agent-3-audit/audit.middleware');

async function runStep6RegressionSuite() {
  log('================================================================================');
  log('MODULE 06 STEP 6: FIX — CLOSING THE INTEGRATION GAP REGRESSION SUITE');
  log(`Timestamp: ${new Date().toISOString()}`);
  log('Evaluating fixes for all 5 demonstrated defects & integration contracts');
  log('================================================================================\n');

  let passed = 0;
  let failed = 0;
  let total = 0;

  function assert(cond, label, details) {
    total++;
    if (cond) {
      passed++;
      log(`[PASS] ${label}${details ? ` — ${details}` : ''}`);
    } else {
      failed++;
      log(`[FAIL] ${label}${details ? ` — ${details}` : ''}`);
    }
  }

  // Shared context fixtures
  const taskStore = {
    getTask(taskId) {
      if (taskId === 'tsk_100') return { id: 'tsk_100', teamId: 'team_alpha', title: 'Task Alpha' };
      if (taskId === 'tsk_200') return { id: 'tsk_200', teamId: 'team_beta', title: 'Task Beta' };
      return null;
    },
  };

  const userStore = {
    users: [
      { id: 'usr_alice', username: 'alice', email: 'alice@alpha.io' },
      { id: 'usr_bob', username: 'bob', email: 'bob@alpha.io' },
      { id: 'usr_charlie', username: 'charlie', email: 'charlie@beta.io' },
    ],
    findByUsername(username) {
      return this.users.find((u) => u.username.toLowerCase() === username.toLowerCase()) || null;
    },
    findById(id) {
      return this.users.find((u) => u.id === id) || null;
    },
  };

  const membershipStore = {
    isMember(teamId, userId) {
      if (teamId === 'team_alpha') return ['usr_alice', 'usr_bob'].includes(userId);
      if (teamId === 'team_beta') return ['usr_charlie'].includes(userId);
      return false;
    },
  };

  const notificationStore = {
    sent: [],
    send(payload) {
      this.sent.push(payload);
      return { id: `ntf_${Date.now()}` };
    },
  };

  const eventBus = new EventBus();

  // --------------------------------------------------------------------------
  // TEST SECTION 1: Fix 1 — Audit Resource Classification & Route Disambiguation
  // --------------------------------------------------------------------------
  log('--- SECTION 1: Fix 1 — Audit Resource Classification & Middleware Routing ---');
  const auditService1 = new AuditService(null);
  const middleware1 = createAuditMiddleware(auditService1);

  // 1.1 Nested comment creation route: POST /tasks/:taskId/comments
  const commentReq = {
    method: 'POST',
    path: '/tasks/tsk_100/comments',
    originalUrl: '/tasks/tsk_100/comments',
    user: { id: 'usr_alice' },
    params: { taskId: 'tsk_100' },
  };
  const commentRes = {
    statusCode: 201,
    json(data) { return data; },
  };

  middleware1(commentReq, commentRes, () => {});
  commentRes.json({ id: 'cmt_555', body: 'Comment via nested route' });

  const commentAuditEntries = auditService1.query({ resourceType: 'comment' });
  assert(commentAuditEntries.length === 1, 'Fix 1.1: Nested comment route recorded as resourceType comment');
  assert(commentAuditEntries[0].resourceId === 'cmt_555', 'Fix 1.2: resourceId is comment ID (cmt_555), not taskId');
  assert(commentAuditEntries[0].metadata?.taskId === 'tsk_100', 'Fix 1.3: taskId preserved in audit metadata');

  // 1.2 Parent task route: POST /tasks
  const taskReq = {
    method: 'POST',
    path: '/tasks',
    originalUrl: '/tasks',
    user: { id: 'usr_alice' },
    params: {},
  };
  const taskRes = {
    statusCode: 201,
    json(data) { return data; },
  };

  middleware1(taskReq, taskRes, () => {});
  taskRes.json({ id: 'tsk_300', title: 'New Task' });

  const taskAuditEntries = auditService1.query({ resourceType: 'task' });
  assert(taskAuditEntries.length === 1, 'Fix 1.4: Base task route recorded as resourceType task');
  assert(taskAuditEntries[0].resourceId === 'tsk_300', 'Fix 1.5: Task resourceId matches tsk_300');

  // --------------------------------------------------------------------------
  // TEST SECTION 2: Fix 2 — Audit Query Filtering by Action & Combinations
  // --------------------------------------------------------------------------
  log('\n--- SECTION 2: Fix 2 — Audit Query Filtering by Action & Combinations ---');
  const auditService2 = new AuditService(null);

  auditService2.record({ action: 'create', resourceType: 'comment', resourceId: 'cmt_1', actorId: 'usr_alice' });
  auditService2.record({ action: 'update', resourceType: 'comment', resourceId: 'cmt_1', actorId: 'usr_alice' });
  auditService2.record({ action: 'delete', resourceType: 'comment', resourceId: 'cmt_1', actorId: 'usr_alice' });
  auditService2.record({ action: 'create', resourceType: 'comment', resourceId: 'cmt_2', actorId: 'usr_bob' });
  auditService2.record({ action: 'create', resourceType: 'task', resourceId: 'tsk_1', actorId: 'usr_alice' });

  // 2.1 Action-only filter
  const onlyDeletes = auditService2.query({ action: 'delete' });
  assert(onlyDeletes.length === 1, 'Fix 2.1: query({ action: "delete" }) returns exactly 1 delete entry');
  assert(onlyDeletes[0].resourceId === 'cmt_1', 'Fix 2.2: Delete record matches cmt_1');

  // 2.2 Multi-criteria filter combination
  const aliceCommentCreates = auditService2.query({
    resourceType: 'comment',
    action: 'create',
    actorId: 'usr_alice',
  });
  assert(aliceCommentCreates.length === 1, 'Fix 2.3: Combined filter (comment + create + alice) returns 1 entry');
  assert(aliceCommentCreates[0].resourceId === 'cmt_1', 'Fix 2.4: Matches cmt_1 created by Alice');

  // 2.3 Action filter combination: all creates
  const allCreates = auditService2.query({ action: 'create' });
  assert(allCreates.length === 3, 'Fix 2.5: query({ action: "create" }) returns 3 total create records');

  // --------------------------------------------------------------------------
  // TEST SECTION 3: Fix 3 — Mention Deduplication by userId
  // --------------------------------------------------------------------------
  log('\n--- SECTION 3: Fix 3 — Mention Deduplication by userId ---');
  const mentionService3 = new MentionNotificationService(notificationStore, eventBus);
  const initialSentCount = notificationStore.sent.length;

  // 3.1 Duplicate mention in single comment text
  const duplicateText = 'Hello @bob and @bob, please review';
  const parsedDups = MentionParser.parse(duplicateText, userStore);
  assert(parsedDups.length === 2, 'Fix 3.1: MentionParser extracted 2 tokens for duplicate @bob');

  const notifyRes3 = mentionService3.notify(parsedDups, {
    actorId: 'usr_alice',
    actorName: 'Alice',
    sourceType: 'comment',
    sourceId: 'cmt_99',
    textSnippet: duplicateText,
  });

  assert(notifyRes3.notifiedCount === 1, 'Fix 3.2: notify() deduplicated recipient to 1 notification');
  assert(notificationStore.sent.length === initialSentCount + 1, 'Fix 3.3: Notification store received exactly 1 message');
  assert(notificationStore.sent[notificationStore.sent.length - 1].recipientId === 'usr_bob', 'Fix 3.4: Recipient is usr_bob');

  // 3.2 Distinct mentions in single comment text
  const multiText = 'Hello @bob and @alice';
  const parsedMulti = MentionParser.parse(multiText, userStore);
  const notifyResMulti = mentionService3.notify(parsedMulti, { actorId: 'usr_charlie' });
  assert(notifyResMulti.notifiedCount === 2, 'Fix 3.5: Distinct users (@bob, @alice) produce 2 notifications');

  // 3.3 Self-mention preservation
  const selfText = 'Self note by @alice';
  const parsedSelf = MentionParser.parse(selfText, userStore);
  const notifyResSelf = mentionService3.notify(parsedSelf, { actorId: 'usr_alice' });
  assert(notifyResSelf.notifiedCount === 0, 'Fix 3.6: Self-mention still filtered out');

  // --------------------------------------------------------------------------
  // TEST SECTION 4: Fix 4 — Notification Audit Integration (Event Pipeline)
  // --------------------------------------------------------------------------
  log('\n--- SECTION 4: Fix 4 — Notification Audit Integration ---');
  const sharedBus4 = new EventBus();
  const auditService4 = new AuditService(sharedBus4);
  const mentionService4 = new MentionNotificationService(notificationStore, sharedBus4);

  // Dispatch mention notification
  mentionService4.notify(
    [{ raw: '@bob', username: 'bob', userId: 'usr_bob' }],
    { actorId: 'usr_alice', actorName: 'Alice', sourceType: 'comment', sourceId: 'cmt_700' },
  );

  const notifAuditLogs = auditService4.query({ resourceType: 'notification' });
  assert(notifAuditLogs.length === 1, 'Fix 4.1: mention.notified captured by AuditService');
  assert(notifAuditLogs[0].action === 'create', 'Fix 4.2: Audit action is create');
  assert(notifAuditLogs[0].actorId === 'usr_alice', 'Fix 4.3: Actor attributed to sender (usr_alice)');
  assert(notifAuditLogs[0].metadata?.mentionedUserId === 'usr_bob', 'Fix 4.4: mentionedUserId preserved in metadata');

  // --------------------------------------------------------------------------
  // TEST SECTION 5: Fix 5 — Tenant Authorization Boundary in getComments()
  // --------------------------------------------------------------------------
  log('\n--- SECTION 5: Fix 5 — Tenant Authorization in getComments() ---');
  const commentsService5 = new CommentsService(eventBus, taskStore, membershipStore);

  // Setup: Alice creates comment on Task Alpha (Team Alpha)
  const alphaCmt = commentsService5.createComment('tsk_100', 'usr_alice', 'Confidential Alpha discussion');
  assert(alphaCmt.id.startsWith('cmt_'), 'Fix 5.1: Alpha comment created');

  // 5.1 Authorized team member access
  const memberComments = commentsService5.getComments('tsk_100', 'usr_bob');
  assert(memberComments.length === 1, 'Fix 5.1: Authorized team member (usr_bob) retrieves comments');

  // 5.2 Non-member / cross-team access blocked with FORBIDDEN
  let crossTeamBlocked = false;
  try {
    commentsService5.getComments('tsk_100', 'usr_charlie');
  } catch (err) {
    crossTeamBlocked = err.message.includes('FORBIDDEN');
  }
  assert(crossTeamBlocked, 'Fix 5.2: Non-member/cross-team caller (usr_charlie) blocked with FORBIDDEN');

  // 5.3 Missing callerUserId (omitted argument) blocked with UNAUTHORIZED
  let omittedCallerBlocked = false;
  try {
    commentsService5.getComments('tsk_100');
  } catch (err) {
    omittedCallerBlocked = err.message.includes('UNAUTHORIZED');
  }
  assert(omittedCallerBlocked, 'Fix 5.3: Omitted callerUserId completely blocked with UNAUTHORIZED (no bypass)');

  // 5.4 Explicit null callerUserId blocked with UNAUTHORIZED
  let nullCallerBlocked = false;
  try {
    commentsService5.getComments('tsk_100', null);
  } catch (err) {
    nullCallerBlocked = err.message.includes('UNAUTHORIZED');
  }
  assert(nullCallerBlocked, 'Fix 5.4: Explicit null callerUserId blocked with UNAUTHORIZED');

  // 5.5 Anonymous caller blocked with UNAUTHORIZED
  let anonymousCallerBlocked = false;
  try {
    commentsService5.getComments('tsk_100', 'anonymous');
  } catch (err) {
    anonymousCallerBlocked = err.message.includes('UNAUTHORIZED');
  }
  assert(anonymousCallerBlocked, 'Fix 5.5: Anonymous caller blocked with UNAUTHORIZED');

  // 5.6 Cross-team access explicitly tested on Team Beta task
  commentsService5.createComment('tsk_200', 'usr_charlie', 'Team Beta confidential roadmap');
  let aliceOnBetaBlocked = false;
  try {
    commentsService5.getComments('tsk_200', 'usr_alice'); // Alice is Team Alpha, task is Team Beta
  } catch (err) {
    aliceOnBetaBlocked = err.message.includes('FORBIDDEN');
  }
  assert(aliceOnBetaBlocked, 'Fix 5.6: Cross-team access (Alice accessing Team Beta task) blocked with FORBIDDEN');

  // 5.7 Non-existent task error
  let notFoundCaught = false;
  try {
    commentsService5.getComments('tsk_missing', 'usr_alice');
  } catch (err) {
    notFoundCaught = err.message.includes('NOT_FOUND');
  }
  assert(notFoundCaught, 'Fix 5.7: Non-existent task throws NOT_FOUND');

  log('\n================================================================================');
  log(`REGRESSION SUITE SUMMARY: ${passed} PASSED, ${failed} FAILED, ${total} TOTAL`);
  log('================================================================================');

  if (failed > 0) {
    process.exitCode = 1;
  }
}

runStep6RegressionSuite().catch(console.error);
