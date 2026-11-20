const fs = require('fs');
const path = require('path');

const logFile = path.resolve(__dirname, 'break-resolved-output.txt');
try {
  fs.writeFileSync(logFile, '', 'utf8');
} catch (e) {}

function log(msg) {
  console.log(msg);
  try {
    fs.appendFileSync(logFile, msg + '\n', 'utf8');
  } catch (e) {}
}

const { EventBus, EventNames } = require('./interface-contracts');
const { CommentsService } = require('./agent-1-comments/comments.service');
const { MentionParser } = require('./agent-2-mentions/mention-parser');
const { MentionNotificationService } = require('./agent-2-mentions/mention-notification.service');
const { AuditService } = require('./agent-3-audit/audit.service');
const { createAuditMiddleware } = require('./agent-3-audit/audit.middleware');

async function runBreakResolvedSuite() {
  log('================================================================================');
  log('MODULE 06 STEP 6: VERIFY BREAK SCENARIOS ARE RESOLVED');
  log(`Timestamp: ${new Date().toISOString()}`);
  log('Demonstrating resolution of all 5 BREAK failure scenarios');
  log('================================================================================\n');

  let resolvedCount = 0;
  const totalScenarios = 5;

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

  // --------------------------------------------------------------------------
  // SCENARIO 1 RESOLUTION: Audit resource classification
  // --------------------------------------------------------------------------
  log('--- SCENARIO 1 RESOLUTION: Audit Middleware Route Classification ---');
  const auditService1 = new AuditService(null);
  const auditMiddleware1 = createAuditMiddleware(auditService1);

  const mockReq1 = {
    method: 'POST',
    path: '/tasks/tsk_100/comments',
    originalUrl: '/tasks/tsk_100/comments',
    user: { id: 'usr_alice' },
    params: { taskId: 'tsk_100' },
  };
  const mockRes1 = {
    statusCode: 201,
    json(data) { return data; },
  };

  auditMiddleware1(mockReq1, mockRes1, () => {});
  mockRes1.json({ id: 'cmt_999', body: 'Comment via HTTP POST' });

  const commentLogs = auditService1.query({ resourceType: 'comment' });
  const taskLogs = auditService1.query({ resourceType: 'task' });
  log(`[VERIFY] comment logs count: ${commentLogs.length}, task logs count: ${taskLogs.length}`);

  if (commentLogs.length === 1 && taskLogs.length === 0 && commentLogs[0].resourceId === 'cmt_999') {
    resolvedCount++;
    log('[RESOLVED] Scenario 1: Comment operation correctly classified as resourceType "comment" with commentId "cmt_999".\n');
  } else {
    log('[STILL FAILING] Scenario 1 was not resolved.\n');
  }

  // --------------------------------------------------------------------------
  // SCENARIO 2 RESOLUTION: AuditService.query() action filter
  // --------------------------------------------------------------------------
  log('--- SCENARIO 2 RESOLUTION: AuditService.query() Action Filter ---');
  const auditService2 = new AuditService(null);
  auditService2.record({ action: 'create', resourceType: 'comment', resourceId: 'cmt_100', actorId: 'usr_alice' });
  auditService2.record({ action: 'delete', resourceType: 'comment', resourceId: 'cmt_100', actorId: 'usr_alice' });

  const deleteQuery = auditService2.query({ resourceType: 'comment', resourceId: 'cmt_100', action: 'delete' });
  log(`[VERIFY] deleteActionQuery.length: ${deleteQuery.length}, actions: ${deleteQuery.map((l) => l.action).join(', ')}`);

  if (deleteQuery.length === 1 && deleteQuery[0].action === 'delete') {
    resolvedCount++;
    log('[RESOLVED] Scenario 2: query() now strictly filters by action, returning only the delete entry.\n');
  } else {
    log('[STILL FAILING] Scenario 2 was not resolved.\n');
  }

  // --------------------------------------------------------------------------
  // SCENARIO 3 RESOLUTION: Mention deduplication
  // --------------------------------------------------------------------------
  log('--- SCENARIO 3 RESOLUTION: Mention Deduplication ---');
  const notifStore3 = { sent: [], send(p) { this.sent.push(p); } };
  const bus3 = new EventBus();
  const mentionService3 = new MentionNotificationService(notifStore3, bus3);

  const doubleText = 'Urgent: @bob and @bob please check the build!';
  const parsed3 = MentionParser.parse(doubleText, userStore);
  const notifyRes3 = mentionService3.notify(parsed3, { actorId: 'usr_alice', textSnippet: doubleText });
  log(`[VERIFY] Tokens parsed: ${parsed3.length}, notifiedCount: ${notifyRes3.notifiedCount}, actual sent: ${notifStore3.sent.length}`);

  if (notifStore3.sent.length === 1 && notifStore3.sent[0].recipientId === 'usr_bob') {
    resolvedCount++;
    log('[RESOLVED] Scenario 3: Duplicate mentions deduplicated to exactly 1 notification.\n');
  } else {
    log('[STILL FAILING] Scenario 3 was not resolved.\n');
  }

  // --------------------------------------------------------------------------
  // SCENARIO 4 RESOLUTION: Notification audit integration
  // --------------------------------------------------------------------------
  log('--- SCENARIO 4 RESOLUTION: Notification Audit Integration ---');
  const bus4 = new EventBus();
  const auditService4 = new AuditService(bus4);
  const notifStore4 = { sent: [], send(p) { this.sent.push(p); } };
  const mentionService4 = new MentionNotificationService(notifStore4, bus4);

  mentionService4.notify(
    [{ raw: '@bob', username: 'bob', userId: 'usr_bob' }],
    { actorId: 'usr_alice', sourceType: 'comment', sourceId: 'cmt_200' },
  );

  const notifAuditLogs = auditService4.query({ resourceType: 'notification' });
  log(`[VERIFY] Audit records for resourceType 'notification': ${notifAuditLogs.length}`);

  if (notifAuditLogs.length === 1 && notifAuditLogs[0].action === 'create' && notifAuditLogs[0].actorId === 'usr_alice') {
    resolvedCount++;
    log('[RESOLVED] Scenario 4: mention.notified events captured by AuditService as resourceType "notification".\n');
  } else {
    log('[STILL FAILING] Scenario 4 was not resolved.\n');
  }

  // --------------------------------------------------------------------------
  // SCENARIO 5 RESOLUTION: Tenant isolation in getComments()
  // --------------------------------------------------------------------------
  log('--- SCENARIO 5 RESOLUTION: Tenant Isolation & Mandatory Authorization in getComments() ---');
  const bus5 = new EventBus();
  const commentsService5 = new CommentsService(bus5, taskStore, membershipStore);

  commentsService5.createComment('tsk_200', 'usr_charlie', 'Team Beta confidential roadmap');

  // Test 1: Omitted caller argument throws UNAUTHORIZED (Authorization bypass eliminated)
  let omittedCallerBlocked = false;
  try {
    commentsService5.getComments('tsk_200');
  } catch (err) {
    omittedCallerBlocked = err.message.includes('UNAUTHORIZED');
  }
  log(`[VERIFY] Omitted caller argument threw UNAUTHORIZED: ${omittedCallerBlocked}`);

  // Test 2: Cross-tenant read by Alice (Team Alpha on Team Beta task) throws FORBIDDEN
  let tenantBlocked = false;
  try {
    commentsService5.getComments('tsk_200', 'usr_alice'); // Alice from Team Alpha trying to read Beta task
  } catch (err) {
    tenantBlocked = err.message.includes('FORBIDDEN');
  }
  log(`[VERIFY] Cross-tenant read by Alice threw FORBIDDEN: ${tenantBlocked}`);

  // Test 3: Authorized member Charlie successfully retrieves comments
  const memberComments = commentsService5.getComments('tsk_200', 'usr_charlie');
  const memberAccessSuccess = memberComments.length === 1;
  log(`[VERIFY] Authorized member Charlie retrieved comments: ${memberAccessSuccess}`);

  if (omittedCallerBlocked && tenantBlocked && memberAccessSuccess) {
    resolvedCount++;
    log('[RESOLVED] Scenario 5: getComments() mandates callerUserId and enforces team boundary (no bypass possible).\n');
  } else {
    log('[STILL FAILING] Scenario 5 was not resolved.\n');
  }

  log('================================================================================');
  log(`RESOLUTION SUMMARY: ${resolvedCount} of ${totalScenarios} BREAK SCENARIOS RESOLVED`);
  log('================================================================================');

  if (resolvedCount !== totalScenarios) {
    process.exitCode = 1;
  }
}

runBreakResolvedSuite().catch(console.error);
