// ============================================================================
// AGENT 2: @MENTION NOTIFICATION SERVICE (FIXED FOR STEP 6)
// ============================================================================

const { EventNames } = require('../interface-contracts');

class MentionNotificationService {
  constructor(notificationService, eventBus) {
    this.notificationService = notificationService;
    this.eventBus = eventBus;
  }

  notify(mentions, context = {}) {
    if (!Array.isArray(mentions)) return { notifiedCount: 0 };

    let notifiedCount = 0;
    const now = new Date().toISOString();
    const seenUserIds = new Set();

    for (const mention of mentions) {
      if (!mention.userId) continue; // Skip non-resolvable usernames

      // Disallow self-notification
      if (context.actorId && mention.userId === context.actorId) continue;

      // Deduplicate: Each unique user receives at most one notification per comment
      if (seenUserIds.has(mention.userId)) continue;
      seenUserIds.add(mention.userId);

      if (this.notificationService && typeof this.notificationService.send === 'function') {
        this.notificationService.send({
          recipientId: mention.userId,
          type: 'MENTION',
          title: `You were mentioned by ${context.actorName || 'a teammate'}`,
          body: context.textSnippet || mention.raw,
          metadata: {
            sourceType: context.sourceType || 'comment',
            sourceId: context.sourceId,
            timestamp: now,
          },
        });
      }

      if (this.eventBus) {
        this.eventBus.emit(EventNames.MENTION_NOTIFIED, {
          mentionedUserId: mention.userId,
          actorId: context.actorId,
          sourceType: context.sourceType || 'comment',
          sourceId: context.sourceId,
          timestamp: now,
        });
      }

      notifiedCount++;
    }

    return { notifiedCount };
  }
}

module.exports = { MentionNotificationService };
