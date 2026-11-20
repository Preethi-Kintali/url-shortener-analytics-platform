// ============================================================================
// MODULE 06: MULTIPLE AGENTS, ONE CODEBASE — INTERFACE CONTRACTS
// ============================================================================

/**
 * Shared Interface Contracts locking down API schemas, DTOs, and event shapes
 * across parallel Agent 1 (Comments), Agent 2 (Mentions), and Agent 3 (Audit Log).
 *
 * SYSTEM-LEVEL INTEGRATION CONTRACT (STEP 6 UPDATE):
 * ===================================================
 * Event Bus:
 *   - All features that create, update, or delete resources MUST emit events
 *     via the shared event bus.
 *   - Event format: {resourceType}.{action}
 *     e.g., comment.created, team.updated, member.deleted, mention.notified
 *   - Event payload MUST include: resourceId, actorId, timestamp
 *   - Event payload SHOULD include: related resource IDs as metadata
 *
 * Audit Log Integration:
 *   - The audit middleware handles HTTP-triggered actions on standard routes.
 *   - For nested resources or non-HTTP-triggered actions, the feature MUST either:
 *     (a) Call auditLog.record() directly, OR
 *     (b) Emit events that the audit-event-subscriber consumes
 *   - Option (b) is preferred — it decouples the feature from the audit system.
 *
 * Resource Type Registry:
 *   - All known resource types: task, team, member, comment, invitation, notification
 *   - When adding a new resource type, update this registry and ensure the audit
 *     middleware can classify routes correctly.
 */

const ResourceTypes = {
  TASK: 'task',
  TEAM: 'team',
  MEMBER: 'member',
  COMMENT: 'comment',
  INVITATION: 'invitation',
  NOTIFICATION: 'notification',
};

const EventNames = {
  COMMENT_CREATED: 'comment.created',
  COMMENT_UPDATED: 'comment.updated',
  COMMENT_DELETED: 'comment.deleted',
  MENTION_NOTIFIED: 'mention.notified',
  TASK_CREATED: 'task.created',
  TASK_UPDATED: 'task.updated',
  TASK_DELETED: 'task.deleted',
  TEAM_CREATED: 'team.created',
  TEAM_UPDATED: 'team.updated',
  TEAM_DELETED: 'team.deleted',
};

class EventBus {
  constructor() {
    this.handlers = new Map();
  }

  subscribe(eventName, handler) {
    if (!this.handlers.has(eventName)) {
      this.handlers.set(eventName, []);
    }
    this.handlers.get(eventName).push(handler);
    return () => {
      const list = this.handlers.get(eventName) || [];
      this.handlers.set(
        eventName,
        list.filter((h) => h !== handler),
      );
    };
  }

  on(eventName, handler) {
    return this.subscribe(eventName, handler);
  }

  emit(eventName, payload) {
    const list = this.handlers.get(eventName) || [];
    const wildcardList = this.handlers.get('*') || [];
    for (const fn of [...list, ...wildcardList]) {
      try {
        fn(eventName, payload);
      } catch (err) {
        console.error(`Error in event handler for ${eventName}:`, err.message);
      }
    }
  }
}

module.exports = {
  ResourceTypes,
  EventNames,
  EventBus,
};
