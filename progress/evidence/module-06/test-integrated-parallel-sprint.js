const fs = require('fs');
const path = require('path');

const logFile = path.resolve(__dirname, 'parallel-sprint-test-output.txt');
try {
  fs.writeFileSync(logFile, '', 'utf8');
} catch (e) {
  // safe fallback
}

function log(msg) {
  console.log(msg);
  try {
    fs.appendFileSync(logFile, msg + '\n', 'utf8');
  } catch (e) {
    // safe fallback
  }
}

const { EventBus, EventNames } = require('./interface-contracts');
const { CommentsService } = require('./agent-1-comments/comments.service');
const { MentionParser } = require('./agent-2-mentions/mention-parser');
const { MentionNotificationService } = require('./agent-2-mentions/mention-notification.service');
const { AuditService } = require('./agent-3-audit/audit.service');

async function runParallelSprintTests() {
  log('================================================================================');
  log('MODULE 06 STEP 3: BUILD — PARALLEL SPRINT VERIFICATION SUITE');
  log(`Timestamp: ${new Date().toISOString()}`);
  log('Evaluating Parallel Agent 1 (Comments), Agent 2 (Mentions), and Agent 3 (Audit Log)');
  log('Integration Pattern: Interface-First (Option A)');
  log('================================================================================\n');

  let passed = 0;
  let total = 0;

  function assert(cond, label, details) {
    total++;
    if (cond) {
      passed++;
      log(`[PASS] ${label}${details ? ` — ${details}` : ''}`);
    } else {
      log(`[FAIL] ${label}${details ? ` — ${details}` : ''}`);
    }
  }

  // Common Context Mocks (Mocking shared dependencies without modifying production files)
  const taskStore = {
    getTask(taskId) {
      if (taskId === 'tsk_100') return { id: 'tsk_100', teamId: 'team_alpha', title: 'Task 100' };
      if (taskId === 'tsk_200') return { id: 'tsk_200', teamId: 'team_beta', title: 'Task 200' };
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
  // SECTION 1: Agent 1 (Comment Threads) Isolated Verification
  // --------------------------------------------------------------------------
  log('--- SECTION 1: Agent 1 (Comment Threads) Isolated Tests ---');
  const commentsService = new CommentsService(eventBus, taskStore, membershipStore);

  // 1.1 Valid comment creation
  const c1 = commentsService.createComment('tsk_100', 'usr_alice', 'Initial root comment by Alice');
  assert(c1.id.startsWith('cmt_') && c1.body === 'Initial root comment by Alice', 'Comment created successfully');
  assert(c1.parentId === null, 'Root comment has parentId null');

  // 1.2 Threaded reply
  const reply1 = commentsService.createComment('tsk_100', 'usr_bob', 'Bob replying to Alice', c1.id);
  assert(reply1.parentId === c1.id, 'Threaded reply references parentId correctly');

  // 1.3 Authorization boundary: Charlie (Team Beta) cannot comment on Task 100 (Team Alpha)
  let forbiddenCaught = false;
  try {
    commentsService.createComment('tsk_100', 'usr_charlie', 'Intruder comment');
  } catch (err) {
    forbiddenCaught = err.message.includes('FORBIDDEN');
  }
  assert(forbiddenCaught, 'Non-team member blocked from commenting with FORBIDDEN');

  // 1.4 List comments for task (Authorized caller Alice in Team Alpha)
  const taskComments = commentsService.getComments('tsk_100', 'usr_alice');
  assert(taskComments.length === 2, 'getComments retrieves all task comments');

  // 1.5 Update comment by author
  const updatedC1 = commentsService.updateComment(c1.id, 'usr_alice', 'Updated root comment body');
  assert(updatedC1.body === 'Updated root comment body', 'Author can update comment');

  // 1.6 Delete comment
  const delRes = commentsService.deleteComment(reply1.id, 'usr_bob');
  assert(delRes.success === true, 'Author can delete comment');
  assert(commentsService.getComments('tsk_100', 'usr_alice').length === 1, 'Deleted comment removed from store');

  // --------------------------------------------------------------------------
  // SECTION 2: Agent 2 (@Mention Parsing & Notification) Isolated Verification
  // --------------------------------------------------------------------------
  log('\n--- SECTION 2: Agent 2 (@Mention Parser & Notification) Isolated Tests ---');
  const mentionService = new MentionNotificationService(notificationStore, eventBus);

  // 2.1 Parse single mention
  const singleMention = MentionParser.parse('Hello @alice please review', userStore);
  assert(singleMention.length === 1 && singleMention[0].username === 'alice', 'Single mention parsed');
  assert(singleMention[0].userId === 'usr_alice', 'Mention resolved to userId: usr_alice');
  assert(singleMention[0].position.start === 6, 'Mention start offset is accurate');

  // 2.2 Parse multiple mentions
  const multiMention = MentionParser.parse('@alice and @bob and @ghost_user', userStore);
  assert(multiMention.length === 3, 'Multiple mentions detected');
  assert(multiMention[0].userId === 'usr_alice' && multiMention[1].userId === 'usr_bob', 'Known users resolved');
  assert(multiMention[2].userId === null, 'Unknown user resolved to null without crashing');

  // 2.3 Dispatch notifications
  const notifyRes = mentionService.notify(multiMention, {
    actorId: 'usr_charlie',
    actorName: 'Charlie',
    sourceType: 'comment',
    sourceId: 'cmt_999',
    textSnippet: 'Review request',
  });
  assert(notifyRes.notifiedCount === 2, 'Notifications dispatched to 2 valid mentioned users');
  assert(notificationStore.sent.length === 2, 'Notification store received 2 outbound messages');

  // 2.4 Self-mention prevention
  const selfNotify = mentionService.notify(
    [{ raw: '@charlie', username: 'charlie', userId: 'usr_charlie' }],
    { actorId: 'usr_charlie' },
  );
  assert(selfNotify.notifiedCount === 0, 'Self-mention ignored (zero notifications dispatched)');

  // --------------------------------------------------------------------------
  // SECTION 3: Agent 3 (Audit Log) Isolated Verification
  // --------------------------------------------------------------------------
  log('\n--- SECTION 3: Agent 3 (Audit Log) Isolated Tests ---');
  const auditService = new AuditService(eventBus);

  // 3.1 Manual record creation
  const logEntry = auditService.record({
    action: 'create',
    resourceType: 'task',
    resourceId: 'tsk_100',
    actorId: 'usr_alice',
    metadata: { title: 'New Task' },
  });
  assert(logEntry.id.startsWith('aud_'), 'Audit log entry created with UUID');
  assert(logEntry.action === 'create' && logEntry.resourceType === 'task', 'Audit fields recorded accurately');

  // 3.2 Query filtering
  const aliceTaskLogs = auditService.query({ actorId: 'usr_alice', resourceType: 'task' });
  assert(aliceTaskLogs.length === 1, 'Query filtered logs by actorId and resourceType');

  // 3.3 Invalid action validation
  let invalidActionCaught = false;
  try {
    auditService.record({ action: 'archive', resourceType: 'task', resourceId: '1', actorId: '1' });
  } catch (err) {
    invalidActionCaught = err.message.includes('INVALID_ACTION');
  }
  assert(invalidActionCaught, 'Invalid audit action rejected with INVALID_ACTION');

  // --------------------------------------------------------------------------
  // SECTION 4: Integrated Parallel Sprint — "The Glue" & Cross-Agent Synergy
  // --------------------------------------------------------------------------
  log('\n--- SECTION 4: Integrated Parallel Sprint (The Event Bus Glue) ---');

  // Wire integration hook: when comment.created fires on eventBus:
  // Parse body with Agent 2, dispatch notifications with Agent 2.
  eventBus.subscribe(EventNames.COMMENT_CREATED, (eventName, payload) => {
    const mentions = MentionParser.parse(payload.body, userStore);
    if (mentions.length > 0) {
      mentionService.notify(mentions, {
        actorId: payload.authorId,
        actorName: userStore.findById(payload.authorId)?.username,
        sourceType: 'comment',
        sourceId: payload.commentId,
        textSnippet: payload.body,
      });
    }
  });

  const prevNotificationCount = notificationStore.sent.length;
  const prevAuditCount = auditService.query({ resourceType: 'comment' }).length;

  // Alice posts a comment with an @mention on Task 100
  const integratedComment = commentsService.createComment(
    'tsk_100',
    'usr_alice',
    'Urgent update: @bob please inspect the deployment pipeline!',
  );

  // Assert Agent 1 completed comment creation
  assert(integratedComment.body.includes('@bob'), 'Comment with mention created');

  // Assert Agent 2 received event, parsed mention, and sent notification to Bob
  const newNotifications = notificationStore.sent.slice(prevNotificationCount);
  assert(newNotifications.length === 1, 'Agent 2: Notification automatically dispatched to Bob');
  assert(newNotifications[0].recipientId === 'usr_bob', 'Recipient is usr_bob');
  assert(newNotifications[0].body.includes('@bob'), 'Notification body contains mention text');

  // Assert Agent 3 captured comment creation automatically via EventBus
  const newAuditLogs = auditService.query({ resourceType: 'comment', resourceId: integratedComment.id });
  assert(newAuditLogs.length === 1, 'Agent 3: Audit log entry automatically captured via EventBus');
  assert(newAuditLogs[0].actorId === 'usr_alice', 'Audit actor is usr_alice');
  assert(newAuditLogs[0].action === 'create', 'Audit action is create');

  log('\n================================================================================');
  log(`SUMMARY: ${passed} of ${total} technical assertions PASSED`);
  log('================================================================================');

  if (passed !== total) {
    process.exitCode = 1;
  }
}

runParallelSprintTests().catch(console.error);
