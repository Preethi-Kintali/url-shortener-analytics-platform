// ============================================================================
// AGENT 3: AUDIT LOG SERVICE (FIXED FOR STEP 6)
// ============================================================================

class AuditService {
  constructor(eventBus = null) {
    this.logs = [];
    this.eventBus = eventBus;

    if (this.eventBus) {
      this.attachEventListeners();
    }
  }

  record({ action, resourceType, resourceId, actorId, metadata = {} }) {
    const validActions = ['create', 'update', 'delete', 'notify'];
    if (!validActions.includes(action)) {
      throw new Error(`INVALID_ACTION: Action must be one of ${validActions.join(', ')}`);
    }

    if (!resourceType || !resourceId || !actorId) {
      throw new Error('MISSING_FIELDS: resourceType, resourceId, and actorId are required');
    }

    const logEntry = {
      id: `aud_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      action,
      resourceType,
      resourceId,
      actorId,
      metadata: metadata || {},
      timestamp: new Date().toISOString(),
    };

    this.logs.push(logEntry);
    return logEntry;
  }

  query({ resourceType, resourceId, actorId, action } = {}) {
    return this.logs.filter((log) => {
      if (resourceType && log.resourceType !== resourceType) return false;
      if (resourceId && log.resourceId !== resourceId) return false;
      if (actorId && log.actorId !== actorId) return false;
      if (action && log.action !== action) return false;
      return true;
    });
  }

  attachEventListeners() {
    this.eventBus.subscribe('*', (eventName, payload) => {
      // Map auxiliary notification event: mention.notified
      if (eventName === 'mention.notified') {
        this.record({
          action: 'create',
          resourceType: 'notification',
          resourceId: `ntf_${payload.sourceId || 'event'}_${payload.mentionedUserId}`,
          actorId: payload.actorId || payload.mentionedUserId || 'usr_system',
          metadata: {
            eventName,
            mentionedUserId: payload.mentionedUserId,
            sourceType: payload.sourceType,
            sourceId: payload.sourceId,
            timestamp: payload.timestamp,
          },
        });
        return;
      }

      // Map standard CRUD event names: {resourceType}.{action}
      let action = null;
      let resourceType = null;
      let resourceId = null;

      if (eventName.endsWith('.created')) action = 'create';
      else if (eventName.endsWith('.updated')) action = 'update';
      else if (eventName.endsWith('.deleted')) action = 'delete';

      if (!action) return;

      if (eventName.startsWith('comment.')) {
        resourceType = 'comment';
        resourceId = payload.commentId;
      } else if (eventName.startsWith('task.')) {
        resourceType = 'task';
        resourceId = payload.taskId;
      } else if (eventName.startsWith('team.')) {
        resourceType = 'team';
        resourceId = payload.teamId;
      }

      if (resourceType && resourceId && payload.authorId) {
        this.record({
          action,
          resourceType,
          resourceId,
          actorId: payload.authorId,
          metadata: {
            eventName,
            timestamp: payload.timestamp,
            taskId: payload.taskId,
          },
        });
      }
    });
  }
}

module.exports = { AuditService };
