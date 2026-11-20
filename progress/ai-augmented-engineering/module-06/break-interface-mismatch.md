# Module 06: Multiple Agents, One Codebase — STEP 5: BREAK
## Forensic Audit: The Interface Mismatch & Coordination Breakdowns

**Course**: Upsk AI-Augmented Engineering (Practitioner Pack)  
**Module**: Module 06 — Multiple Agents, One Codebase  
**Step**: STEP 5: BREAK — The Interface Mismatch  
**Reproduction Script**: `progress/evidence/module-06/repro-break.js`  
**Reproduction Output**: `progress/evidence/module-06/break-repro-output.txt`  
**Status**: All 5 failure scenarios successfully reproduced with deterministic execution proof  

---

## 1. Executive Summary

In Step 5, we investigate the fundamental breakdown that occurs when multiple autonomous agents build components in parallel based on local interface contracts that specify what each component produces, but fail to lock down **how components connect**.

The primary symptom highlighted by the official course material is:
> *"Comments are working and audit logs are working, but comments never show up in the audit log."*

Both features pass their individual tests. Both features work in isolation. Yet the cross-feature integration is completely broken.

Using our automated reproduction suite ([repro-break.js](../../evidence/module-06/repro-break.js)), we reproduced this official mismatch along with the four critical defects uncovered during Step 4 verification.

---

## 2. Scenario 1: The Official Course BREAK — The Interface Mismatch

### 2.1 The Symptom
A user creates a comment via `POST /tasks/:taskId/comments`. The comment is stored in the database, and the client receives a `201 Created` response. However, an audit query for comments returns empty:
```javascript
auditService.query({ resourceType: 'comment' }); // Returns []
```

### 2.2 Live Reproduction Output
From [break-repro-output.txt](../../evidence/module-06/break-repro-output.txt#L7-L14):
```
--- SCENARIO 1: Official Course BREAK — The Interface Mismatch ---
Context: Agent 1 emits comment.created to EventBus.
Agent 3 uses HTTP middleware on routes mounted at /tasks/:taskId/comments.
[REPRO] Query for resourceType: 'comment' in audit log: count = 0
[REPRO] Query for resourceType: 'task' in audit log: count = 1
[REPRO] Misclassified Entry: action=create, resourceType=task, resourceId=tsk_100
[OUTCOME] Scenario 1 Reproduced: CONFIRMED
```

### 2.3 Root Cause Analysis
1. **Divergent Integration Mechanisms**:
   - Agent 1 was instructed to emit events: `eventBus.emit('comment.created', { commentId, taskId, authorId, timestamp })`.
   - Agent 3 was instructed to intercept HTTP mutations via middleware on Express routes.
2. **Route Prefix Ambiguity**:
   - Comments are accessed through nested routes (`/tasks/:taskId/comments`).
   - Agent 3's middleware inspects the route prefix: because the path begins with `/tasks`, it misclassifies the action as `resourceType: "task"` and `resourceId: "tsk_100"`.
3. **Event Orphanage**:
   - Agent 3 did not subscribe to Agent 1's `comment.created` event on the EventBus because Agent 3 assumed HTTP middleware would handle all logging. Agent 1's events are emitted into the void.

---

## 3. Scenario 2: `AuditService.query()` Action Filter Omission

### 3.1 The Symptom
When an auditor queries for all deleted comments on a task (`query({ resourceType: 'comment', resourceId: 'cmt_100', action: 'delete' })`), the query returns both `create` and `delete` records.

### 3.2 Live Reproduction Output
From [break-repro-output.txt](../../evidence/module-06/break-repro-output.txt#L16-L21):
```
--- SCENARIO 2: AuditService.query() Action Filter Omission ---
[REPRO] Expected deleteActionQuery.length: 1 (only delete action)
[REPRO] Actual deleteActionQuery.length: 2
[REPRO] Returned Actions: create, delete
[OUTCOME] Scenario 2 Reproduced: CONFIRMED
```

### 3.3 Root Cause Analysis
In [audit.service.js](../../evidence/module-06/agent-3-audit/audit.service.js#L39-L46):
```javascript
query({ resourceType, resourceId, actorId } = {}) {
  return this.logs.filter((log) => {
    if (resourceType && log.resourceType !== resourceType) return false;
    if (resourceId && log.resourceId !== resourceId) return false;
    if (actorId && log.actorId !== actorId) return false;
    return true; // Missing: if (action && log.action !== action) return false;
  });
}
```
The parameter destructuring and filter predicate completely omit `action`. Any consumer filtering by action receives unfiltered results containing all CRUD mutations.

---

## 4. Scenario 3: Notification Spam (Missing Mention Deduplication)

### 4.1 The Symptom
If a comment mentions the same user multiple times (e.g. `"Urgent: @bob and @bob please check the build!"`), the recipient receives multiple notifications for a single comment.

### 4.2 Live Reproduction Output
From [break-repro-output.txt](../../evidence/module-06/break-repro-output.txt#L23-L29):
```
--- SCENARIO 3: Notification Duplication via Duplicate Mentions ---
[REPRO] Parsed mention tokens count: 2
[REPRO] notify() reported notifiedCount: 2
[REPRO] Actual notifications sent to store: 2
[REPRO] Recipients: usr_bob, usr_bob
[OUTCOME] Scenario 3 Reproduced: CONFIRMED
```

### 4.3 Root Cause Analysis
In [mention-parser.js](../../evidence/module-06/agent-2-mentions/mention-parser.js#L19-L39), regex scanning matches every occurrence of `@bob`.
In [mention-notification.service.js](../../evidence/module-06/agent-2-mentions/mention-notification.service.js#L19-L49):
```javascript
for (const mention of mentions) {
  if (!mention.userId) continue;
  if (context.actorId && mention.userId === context.actorId) continue;
  // Missing: Deduplication by userId (Set of already notified userIds)
  this.notificationService.send({ recipientId: mention.userId, ... });
  notifiedCount++;
}
```
Without deduplication, notification volume scales with the number of duplicate tokens rather than unique recipients.

---

## 5. Scenario 4: Cross-Agent Event Gap (`mention.notified` Uncaptured)

### 5.1 The Symptom
When a notification is dispatched, Agent 2 emits `mention.notified`. However, zero audit log records are created.

### 5.2 Live Reproduction Output
From [break-repro-output.txt](../../evidence/module-06/break-repro-output.txt#L31-L35):
```
--- SCENARIO 4: Cross-Agent Event Gap on mention.notified ---
[REPRO] Audit records for resourceType 'notification': 0
[REPRO] Total audit records captured on mention event: 0
[OUTCOME] Scenario 4 Reproduced: CONFIRMED
```

### 5.3 Root Cause Analysis
In [audit.service.js](../../evidence/module-06/agent-3-audit/audit.service.js#L55-L59):
```javascript
if (eventName.endsWith('.created')) action = 'create';
else if (eventName.endsWith('.updated')) action = 'update';
else if (eventName.endsWith('.deleted')) action = 'delete';
if (!action) return; // 'mention.notified' ends with '.notified' -> ignored!
```
Agent 3's contract assumed only standard resource CRUD events (`*.created`, `*.updated`, `*.deleted`). Auxiliary notification events fall through the filter and are discarded.

---

## 6. Scenario 5: Tenant Isolation Bypass in `getComments()`

### 6.1 The Symptom
User Alice (Team Alpha) calls `commentsService.getComments('tsk_200')` for a task owned by Team Beta. The method returns Team Beta's confidential comments without error.

### 6.2 Live Reproduction Output
From [break-repro-output.txt](../../evidence/module-06/break-repro-output.txt#L37-L42):
```
--- SCENARIO 5: Tenant Isolation Bypass in getComments() ---
[REPRO] Created Team Beta comment: cmt_1795021556069_447 on task tsk_200
[REPRO] Comments retrieved from tsk_200 by unverified caller: 1
[REPRO] Leaked comment body: "Team Beta confidential roadmap" by author: usr_charlie
[OUTCOME] Scenario 5 Reproduced: CONFIRMED
```

### 6.3 Root Cause Analysis
In [comments.service.js](../../evidence/module-06/agent-1-comments/comments.service.js#L64-L66):
```javascript
getComments(taskId) {
  return Array.from(this.comments.values()).filter((c) => c.taskId === taskId);
}
```
Unlike `createComment()`, which checks `this.membershipStore.isMember(task.teamId, authorId)`, `getComments()` does not accept `userId` or perform any authorization check.

---

## 7. Comparative Matrix of Confirmed BREAK Scenarios

| Scenario | Symptom | Component Boundary | Root Cause Type |
|---|---|---|---|
| **1. Official Interface Mismatch** | Comments never appear in audit log or show as task actions | Agent 1 (Comments) ↔ Agent 3 (Audit) | Architecture & Event Flow Mismatch |
| **2. Audit Query Filtering** | Action filter ignored in audit queries | Agent 3 (AuditService) | Incomplete Implementation |
| **3. Duplicate Mention Spam** | Repeated notifications for duplicate mentions | Agent 2 (MentionService) | Missing Input Normalization |
| **4. Unaudited Mentions** | `mention.notified` dropped silently | Agent 2 (Mentions) ↔ Agent 3 (Audit) | Asymmetric Event Contract |
| **5. Tenant Read Leak** | Comments readable across tenant teams | Agent 1 (CommentsService) | Missing Layer-2 Defense |

---

## 8. Preserving Evidence for Step 6 FIX

As required by Step 5 constraints, **no production or module source code has been modified**. All five defects remain active and reproducible in the course environment. Step 6 (FIX) will systematically resolve these coordination mismatches and contract gaps.
