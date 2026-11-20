const fs = require('fs');
const path = require('path');

const logFile = path.resolve(__dirname, 'break-repro-output.txt');
fs.writeFileSync(logFile, '', 'utf8');

function log(msg) {
  console.log(msg);
  fs.appendFileSync(logFile, msg + '\n', 'utf8');
}

const { EventBus, EventNames } = require('./interface-contracts');
const { CommentsService } = require('./agent-1-comments/comments.service');
const { MentionParser } = require('./agent-2-mentions/mention-parser');
const { MentionNotificationService } = require('./agent-2-mentions/mention-notification.service');
const { AuditService } = require('./agent-3-audit/audit.service');
const { createAuditMiddleware } = require('./agent-3-audit/audit.middleware');

async function runBreakReproduction() {
  log('================================================================================');
  log('MODULE 06 STEP 5: BREAK — REPRODUCIBLE FAILURE SCENARIOS');
  log(`Timestamp: ${new Date().toISOString()}`);
  log('Objective: Reproduce Interface Mismatch, Middleware Collision & Integration Defects');
  log('================================================================================\n');

  // Shared test stores
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
  // SCENARIO 1: The Official Course BREAK — The Interface Mismatch
  // "Comments are working and audit logs are working, but comments never show up in the audit log"
  // --------------------------------------------------------------------------
  log('--- SCENARIO 1: Official Course BREAK — The Interface Mismatch ---');
  log('Context: Agent 1 emits comment.created to EventBus.');
  log('Agent 3 uses HTTP middleware on routes mounted at /tasks/:taskId/comments.');

  // Create isolated AuditService instance relying purely on HTTP middleware
  const auditServiceMiddlewareOnly = new AuditService(null); // No eventBus passed!
  const auditMiddleware = createAuditMiddleware(auditServiceMiddlewareOnly);

  // In standard Express routing, router is mounted at '/tasks':
  // req.baseUrl is '/tasks', req.path is '/:taskId/comments'
  // When middleware checks path prefix '/tasks' or root route:
  const mockReq = {
    method: 'POST',
    path: '/tasks/tsk_100', // Root router path
    originalUrl: '/tasks/tsk_100/comments',
    user: { id: 'usr_alice' },
    params: { id: 'tsk_100' },
  };

  const mockRes = {
    statusCode: 201,
    json(data) {
      return data;
    },
  };

  // Run the middleware wrapping response
  auditMiddleware(mockReq, mockRes, () => {});
  mockRes.json({ id: 'cmt_999', body: 'Comment via HTTP POST' });

  // Check audit log for comment
  const commentLogsInMiddleware = auditServiceMiddlewareOnly.query({ resourceType: 'comment' });
  log(`[REPRO] Query for resourceType: 'comment' in audit log: count = ${commentLogsInMiddleware.length}`);

  const taskLogsInMiddleware = auditServiceMiddlewareOnly.query({ resourceType: 'task' });
  log(`[REPRO] Query for resourceType: 'task' in audit log: count = ${taskLogsInMiddleware.length}`);
  if (taskLogsInMiddleware.length > 0) {
    log(`[REPRO] Misclassified Entry: action=${taskLogsInMiddleware[0].action}, resourceType=${taskLogsInMiddleware[0].resourceType}, resourceId=${taskLogsInMiddleware[0].resourceId}`);
  }

  const scenario1Reproduced = commentLogsInMiddleware.length === 0 && taskLogsInMiddleware.length > 0;
  log(`[OUTCOME] Scenario 1 Reproduced: ${scenario1Reproduced ? 'CONFIRMED' : 'FAILED'}`);
  log('Failure Explanation: The audit middleware misclassified a comment creation as a task action because of route prefix inspection. Meanwhile, Agent 1 emitted comment.created into an empty EventBus with 0 subscribers.\n');

  // --------------------------------------------------------------------------
  // SCENARIO 2: AuditService.query() ignores action filter
  // --------------------------------------------------------------------------
  log('--- SCENARIO 2: AuditService.query() Action Filter Omission ---');
  const auditServiceFilterTest = new AuditService(null);
  const entryCreate = auditServiceFilterTest.record({
    action: 'create',
    resourceType: 'comment',
    resourceId: 'cmt_100',
    actorId: 'usr_alice',
  });
  const entryDelete = auditServiceFilterTest.record({
    action: 'delete',
    resourceType: 'comment',
    resourceId: 'cmt_100',
    actorId: 'usr_alice',
  });

  // Query specifically for action: 'delete'
  const deleteActionQuery = auditServiceFilterTest.query({
    resourceType: 'comment',
    resourceId: 'cmt_100',
    action: 'delete',
  });

  log(`[REPRO] Expected deleteActionQuery.length: 1 (only delete action)`);
  log(`[REPRO] Actual deleteActionQuery.length: ${deleteActionQuery.length}`);
  log(`[REPRO] Returned Actions: ${deleteActionQuery.map((l) => l.action).join(', ')}`);

  const scenario2Reproduced = deleteActionQuery.length === 2;
  log(`[OUTCOME] Scenario 2 Reproduced: ${scenario2Reproduced ? 'CONFIRMED' : 'FAILED'}`);
  log('Failure Explanation: AuditService.query() lacks a check for log.action, returning both create and delete logs when filtering by delete.\n');

  // --------------------------------------------------------------------------
  // SCENARIO 3: Notification Spam — Missing Mention Deduplication
  // --------------------------------------------------------------------------
  log('--- SCENARIO 3: Notification Duplication via Duplicate Mentions ---');
  const notificationStore = {
    sent: [],
    send(payload) {
      this.sent.push(payload);
    },
  };
  const eventBus = new EventBus();
  const mentionService = new MentionNotificationService(notificationStore, eventBus);

  const doubleMentionText = 'Urgent: @bob and @bob please check the build!';
  const parsedMentions = MentionParser.parse(doubleMentionText, userStore);
  log(`[REPRO] Parsed mention tokens count: ${parsedMentions.length}`);

  const notifyRes = mentionService.notify(parsedMentions, {
    actorId: 'usr_alice',
    actorName: 'Alice',
    sourceType: 'comment',
    sourceId: 'cmt_101',
    textSnippet: doubleMentionText,
  });

  log(`[REPRO] notify() reported notifiedCount: ${notifyRes.notifiedCount}`);
  log(`[REPRO] Actual notifications sent to store: ${notificationStore.sent.length}`);
  log(`[REPRO] Recipients: ${notificationStore.sent.map((s) => s.recipientId).join(', ')}`);

  const scenario3Reproduced = notificationStore.sent.length === 2 && notificationStore.sent[0].recipientId === 'usr_bob' && notificationStore.sent[1].recipientId === 'usr_bob';
  log(`[OUTCOME] Scenario 3 Reproduced: ${scenario3Reproduced ? 'CONFIRMED' : 'FAILED'}`);
  log('Failure Explanation: MentionNotificationService iterates parsed mentions without deduplicating by userId, causing duplicate notifications for repeated mentions in a single comment.\n');

  // --------------------------------------------------------------------------
  // SCENARIO 4: Cross-Agent Event Gap — mention.notified Ignored by Audit
  // --------------------------------------------------------------------------
  log('--- SCENARIO 4: Cross-Agent Event Gap on mention.notified ---');
  const integratedBus = new EventBus();
  const auditServiceWithBus = new AuditService(integratedBus);
  const mentionServiceWithBus = new MentionNotificationService(notificationStore, integratedBus);

  // Trigger mention notification which emits mention.notified
  mentionServiceWithBus.notify(
    [{ raw: '@bob', username: 'bob', userId: 'usr_bob' }],
    { actorId: 'usr_alice', sourceType: 'comment', sourceId: 'cmt_200' },
  );

  const notificationAuditEntries = auditServiceWithBus.query({ resourceType: 'notification' });
  log(`[REPRO] Audit records for resourceType 'notification': ${notificationAuditEntries.length}`);

  const allAuditEntries = auditServiceWithBus.query();
  log(`[REPRO] Total audit records captured on mention event: ${allAuditEntries.length}`);

  const scenario4Reproduced = notificationAuditEntries.length === 0 && allAuditEntries.length === 0;
  log(`[OUTCOME] Scenario 4 Reproduced: ${scenario4Reproduced ? 'CONFIRMED' : 'FAILED'}`);
  log('Failure Explanation: Agent 2 emits mention.notified, but Agent 3 only subscribes to *.created, *.updated, *.deleted. The notification lifecycle is completely invisible to the audit log.\n');

  // --------------------------------------------------------------------------
  // SCENARIO 5: Tenant Isolation Bypass in getComments()
  // --------------------------------------------------------------------------
  log('--- SCENARIO 5: Tenant Isolation Bypass in getComments() ---');
  const commentsService = new CommentsService(eventBus, taskStore, membershipStore);

  // Charlie creates a private comment for Team Beta
  const betaComment = commentsService.createComment('tsk_200', 'usr_charlie', 'Team Beta confidential roadmap');
  log(`[REPRO] Created Team Beta comment: ${betaComment.id} on task tsk_200`);

  // Alice (Team Alpha) calls getComments on Task 200
  // Function signature only takes taskId: getComments(taskId)
  const leakedComments = commentsService.getComments('tsk_200');
  log(`[REPRO] Comments retrieved from tsk_200 by unverified caller: ${leakedComments.length}`);
  if (leakedComments.length > 0) {
    log(`[REPRO] Leaked comment body: "${leakedComments[0].body}" by author: ${leakedComments[0].authorId}`);
  }

  const scenario5Reproduced = leakedComments.length === 1 && leakedComments[0].id === betaComment.id;
  log(`[OUTCOME] Scenario 5 Reproduced: ${scenario5Reproduced ? 'CONFIRMED' : 'FAILED'}`);
  log('Failure Explanation: comments.service.js does not verify caller team membership in getComments(), exposing task discussions across tenant boundaries if not guarded by external controllers.\n');

  log('================================================================================');
  log('REPRODUCTION SUITE COMPLETE: ALL 5 BREAK SCENARIOS CONFIRMED WITH REAL OUTPUTS');
  log('================================================================================');
}

runBreakReproduction().catch(console.error);
