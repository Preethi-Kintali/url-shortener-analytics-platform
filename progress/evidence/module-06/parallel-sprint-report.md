# Module 06: Multiple Agents, One Codebase — STEP 3: BUILD
## Deliverable: The Parallel Sprint (Option A: Interface-First)

**Course**: Upsk AI-Augmented Engineering (Practitioner Pack)  
**Module**: Module 06 — Multiple Agents, One Codebase  
**Step**: STEP 3: BUILD — The Parallel Sprint  
**Decision Followed**: Option A — Interface-First  
**Execution Strategy**: Parallel Development with Locked Interface Contracts & Sequential EventBus Integration  

---

## 1. Executive Summary & Objective

In this step, we executed a coordinated parallel development sprint comprising three autonomous AI agents operating on disjoint sub-systems of the Team Collaboration domain:
1. **Agent 1: Comment Threads** (`progress/evidence/module-06/agent-1-comments/`)
2. **Agent 2: @Mention Parsing & Notification** (`progress/evidence/module-06/agent-2-mentions/`)
3. **Agent 3: Audit Log System** (`progress/evidence/module-06/agent-3-audit/`)

To prevent the **Merge Problem** (divergent schema mutations, migration timestamp collisions, conflicting route registrations, and incompatible test fixtures), we enforced **Option A (Interface-First)**. Prior to agent code generation, we established formal **Minimum Effective Interface Contracts** (`progress/evidence/module-06/interface-contracts.js`). 

All three agents generated modular, production-grade JavaScript implementations that adhere to their respective contracts. An asynchronous **EventBus** served as "The Glue" connecting the disparate domains without coupling their source trees. The entire integrated system was validated using a 28-assertion verification suite (`progress/evidence/module-06/test-integrated-parallel-sprint.js`), achieving a **100% pass rate (28/28 assertions passing)**.

---

## 2. Parallel Agent Decomposition & Ownership Matrix

| Dimension | Agent 1: Comment Threads | Agent 2: @Mention System | Agent 3: Audit Log System |
|---|---|---|---|
| **Role & Purpose** | Core task discussion, threaded replies, and lifecycle events | Parsing `@username` tokens and dispatching user notifications | Compliance audit trail capturing mutating actions across all resources |
| **Directory Scope** | `progress/evidence/module-06/agent-1-comments/` | `progress/evidence/module-06/agent-2-mentions/` | `progress/evidence/module-06/agent-3-audit/` |
| **Created Files** | `comments.service.js` | `mention-parser.js`, `mention-notification.service.js` | `audit.service.js`, `audit.middleware.js` |
| **Reads (Immutable)** | `Task` schema, `User` schema, Auth Guard, Team membership | `User` schema (for username-to-UUID resolution) | Auth principal token, `User` schema |
| **Modifies** | None (standalone module mounting to route tree) | None (pure utility and notification service) | None (express/connect middleware wrapper) |
| **Emitted Events** | `comment.created`, `comment.updated`, `comment.deleted` | `mention.notified` | None (terminal consumer & query API) |
| **Consumed Events** | None (source entity) | Optional consumer of text bodies | Consumes `*.created`, `*.updated`, `*.deleted` |
| **Data Entities** | `Comment` (`id`, `taskId`, `authorId`, `body`, `parentId`, `createdAt`) | `ParsedMention` (`raw`, `username`, `userId`, `position`) | `AuditLog` (`id`, `action`, `resourceType`, `resourceId`, `actorId`, `metadata`) |

---

## 3. Formal Interface Contracts (`interface-contracts.js`)

Before running any agent, we authored the formal interface contracts and shared event infrastructure:

```javascript
// progress/evidence/module-06/interface-contracts.js

const EventNames = {
  COMMENT_CREATED: 'comment.created',
  COMMENT_UPDATED: 'comment.updated',
  COMMENT_DELETED: 'comment.deleted',
  MENTION_NOTIFIED: 'mention.notified',
  TASK_CREATED: 'task.created',
  TASK_UPDATED: 'task.updated',
  TASK_DELETED: 'task.deleted',
};

class EventBus {
  constructor() {
    this.listeners = new Map();
  }

  subscribe(eventName, handler) {
    if (!this.listeners.has(eventName)) {
      this.listeners.set(eventName, []);
    }
    this.listeners.get(eventName).push(handler);
    return () => {
      const handlers = this.listeners.get(eventName) || [];
      this.listeners.set(eventName, handlers.filter(h => h !== handler));
    };
  }

  publish(eventName, payload) {
    const directHandlers = this.listeners.get(eventName) || [];
    for (const handler of directHandlers) {
      try { handler(payload); } catch (err) { console.error(`Error in ${eventName} handler:`, err); }
    }
    for (const [pattern, handlers] of this.listeners.entries()) {
      if (pattern.endsWith('*') && eventName.startsWith(pattern.slice(0, -1))) {
        for (const handler of handlers) {
          try { handler({ eventName, ...payload }); } catch (err) { console.error(`Error in wildcard handler:`, err); }
        }
      }
    }
  }
}
```

### Key Contract Rules Enforced
1. **Contract Locking**: Neither Agent 1, 2, nor 3 was allowed to modify `interface-contracts.js`. This eliminated concurrent schema edits.
2. **Disjoint Model Namespaces**: Comments and Audit Logs maintain dedicated data structures referencing foreign keys (`taskId`, `authorId`, `actorId`) rather than mutating base task models.
3. **Decoupled Cross-Agent Interactions**: Agent 1 has zero imports from Agent 2 or Agent 3. Agent 2 has zero imports from Agent 1. All cross-feature coordination flows through standard event envelopes.

---

## 4. Agent Prompts & Context Engineering

Each agent was executed with a structured prompt following the Module 03 layered context pattern:

### Agent 1 Prompt (Comments)
- **Architectural Context**: NestJS/Express service conventions, in-memory repository mock, tenant isolation guards, and UUID validation.
- **Assigned Contract**: Create `comments.service.js` with `createComment`, `getComments`, `updateComment`, `deleteComment`. Support threaded replies via optional `parentId`. Emit `comment.created`, `comment.updated`, `comment.deleted`.
- **Negative Constraints**: Do NOT alter `models/task.js`. Do NOT import from `services/mention-notification.js`. Do NOT implement audit logging directly.

### Agent 2 Prompt (@Mentions)
- **Architectural Context**: Pure utility parsing regex `/@([a-zA-Z0-9._-]+)/g`, zero network side effects during parse, asynchronous notification dispatcher.
- **Assigned Contract**: Create `mention-parser.js` (`parse(text)`) returning token positions and username; create `mention-notification.service.js` (`notify(mentions, context)`) dispatching notifications, ignoring self-mentions, and emitting `mention.notified`.
- **Negative Constraints**: Do NOT hardcode comment entity schemas. Do NOT couple parser to HTTP request lifecycle.

### Agent 3 Prompt (Audit Log)
- **Architectural Context**: Middleware interception pattern for HTTP mutations, standalone audit storage repository, wildcard event consumer.
- **Assigned Contract**: Create `audit.service.js` (`record()`, `query()`) accepting `action`, `resourceType`, `resourceId`, `actorId`, `metadata`; create `audit.middleware.js` intercepting POST, PUT, DELETE requests.
- **Negative Constraints**: Do NOT mutate route handlers directly. Gracefully tolerate missing auth tokens or unauthenticated health checks.

---

## 5. Implementation Review

### Agent 1: Comment Threads (`agent-1-comments/comments.service.js`)
- Enforces team authorization: Users must belong to the task's team to view or post comments.
- Supports hierarchical discussions: Child comments validate that `parentId` exists and belongs to the same task.
- Author-only mutations: Updates and deletions require the caller to match `authorId`.
- Event publication: Emits `comment.created` containing `commentId`, `taskId`, `authorId`, `body`, and `timestamp`.

### Agent 2: @Mention Parser & Notification (`agent-2-mentions/`)
- `mention-parser.js`: Robust regex matching extracting mentions, identifying character offsets (`start`, `end`), and safely resolving user IDs via dependency injection. Unknown users resolve to `userId: null` without failing.
- `mention-notification.service.js`: Filters out duplicate mentions and self-mentions (`authorId === mentionedUserId`). Dispatches notifications and records delivery telemetry.

### Agent 3: Audit Log System (`agent-3-audit/`)
- `audit.service.js`: Stores immutable audit records with timestamp, actor ID, and metadata. Provides query capabilities filtered by `actorId` and `resourceType`. Subscribes to wildcard events (`comment.*`, `task.*`) on the EventBus.
- `audit.middleware.js`: Express-compatible middleware capturing response completions on mutating HTTP methods (POST, PUT, DELETE) and extracting the acting principal from `req.user`.

---

## 6. Integration Architecture ("The Glue")

The critical step in Option A is bridging the gap between independent agents without violating decoupling.

```mermaid
flowchart TD
    User["API Client / User"] -->|POST /tasks/:id/comments| A1["Agent 1: CommentsService"]
    A1 -->|1. Store Comment| DB[(Comment Store)]
    A1 -->|2. Publish 'comment.created'| EB{"Central EventBus"}
    
    subgraph "The Glue (Integration Layer)"
        EB -->|Event Hook: comment.created| G1["Mention Integration Hook"]
        EB -->|Wildcard Hook: comment.*| A3["Agent 3: AuditService"]
    end
    
    G1 -->|3. Call parse()| A2P["Agent 2: MentionParser"]
    A2P -->|4. Return mentions| G1
    G1 -->|5. Call notify()| A2N["Agent 2: NotificationService"]
    A2N -->|6. Dispatch notifications| Inboxes["Mentioned Users' Inboxes"]
    A3 -->|7. Record audit log| AuditDB[(Audit Log Store)]
```

### The Integration Glue Code:
```javascript
// Integration hook connects Agent 1 event emission to Agent 2 notification
eventBus.subscribe(EventNames.COMMENT_CREATED, async (payload) => {
  const mentions = mentionParser.parse(payload.body, mockUserStore);
  if (mentions.length > 0) {
    await mentionNotificationService.notify(mentions, {
      sourceType: 'comment',
      sourceId: payload.commentId,
      authorId: payload.authorId,
      taskId: payload.taskId,
    });
  }
});
```

Because Agent 1 published a clean, contract-compliant event and Agent 2 exposed a clean callable interface, the integration glue required only **12 lines of code** and zero changes to either agent's source files.

---

## 7. Verification & Test Results

The test suite (`test-integrated-parallel-sprint.js`) executed 28 targeted technical assertions across 4 verification phases:

```
================================================================================
MODULE 06 STEP 3: BUILD — PARALLEL SPRINT VERIFICATION SUITE
Timestamp: 2026-11-18T16:40:43.130Z
Evaluating Parallel Agent 1 (Comments), Agent 2 (Mentions), and Agent 3 (Audit Log)
Integration Pattern: Interface-First (Option A)
================================================================================

--- SECTION 1: Agent 1 (Comment Threads) Isolated Tests ---
[PASS] Comment created successfully
[PASS] Root comment has parentId null
[PASS] Threaded reply references parentId correctly
[PASS] Non-team member blocked from commenting with FORBIDDEN
[PASS] getComments retrieves all task comments
[PASS] Author can update comment
[PASS] Author can delete comment
[PASS] Deleted comment removed from store

--- SECTION 2: Agent 2 (@Mention Parser & Notification) Isolated Tests ---
[PASS] Single mention parsed
[PASS] Mention resolved to userId: usr_alice
[PASS] Mention start offset is accurate
[PASS] Multiple mentions detected
[PASS] Known users resolved
[PASS] Unknown user resolved to null without crashing
[PASS] Notifications dispatched to 2 valid mentioned users
[PASS] Notification store received 2 outbound messages
[PASS] Self-mention ignored (zero notifications dispatched)

--- SECTION 3: Agent 3 (Audit Log) Isolated Tests ---
[PASS] Audit log entry created with UUID
[PASS] Audit fields recorded accurately
[PASS] Query filtered logs by actorId and resourceType
[PASS] Invalid audit action rejected with INVALID_ACTION

--- SECTION 4: Integrated Parallel Sprint (The Event Bus Glue) ---
[PASS] Comment with mention created
[PASS] Agent 2: Notification automatically dispatched to Bob
[PASS] Recipient is usr_bob
[PASS] Notification body contains mention text
[PASS] Agent 3: Audit log entry automatically captured via EventBus
[PASS] Audit actor is usr_alice
[PASS] Audit action is create

================================================================================
SUMMARY: 28 of 28 technical assertions PASSED
================================================================================
```

---

## 8. Merge Defense & Conflict Avoidance Analysis

1. **Zero Git Merge Conflicts**:
   By placing each agent's code in a dedicated sub-directory (`agent-1-comments/`, `agent-2-mentions/`, `agent-3-audit/`), no two agents touched the same file.
2. **Schema Immunity**:
   Shared schemas (`schema.prisma`) remained untouched. Entities interact via foreign keys and event payloads.
3. **Additive Integration**:
   The glue code operates purely on subscriptions to the shared EventBus, meaning new parallel agents (e.g. Activity Feed or Search Indexer) can be added without modifying existing agents.

---

## 9. Conclusion & Readiness

The Parallel Sprint has been fully implemented, integrated, and verified against the official Upsk Module 06 Step 3 requirements. The evidence confirms that Option A (Interface-First) successfully eliminated the Merge Problem while unlocking concurrent development velocity.
