export type ActivityEventType =
  | 'MEMBER_INVITED'
  | 'MEMBER_JOINED'
  | 'LINK_CREATED'
  | 'TEAM_UPDATED';

export interface ActivityEvent<T = Record<string, unknown>> {
  id: string;
  sequenceNumber: number;
  teamId: string;
  eventType: ActivityEventType;
  actorId: string;
  payload: T;
  timestamp: string;
}

export interface IActivityFeedSubscriber {
  clientId: string;
  teamId: string;
  send(event: ActivityEvent): void;
}

export class ActivityFeedService {
  private teamSubscribers: Map<string, Set<IActivityFeedSubscriber>> = new Map();
  private teamEventBuffers: Map<string, ActivityEvent[]> = new Map();
  private teamSequenceNumbers: Map<string, number> = new Map();
  private readonly maxBufferSize = 50;

  // Publish a new activity event to all active team subscribers
  publishEvent<T = Record<string, unknown>>(
    teamId: string,
    eventType: ActivityEventType,
    actorId: string,
    rawPayload: T,
  ): ActivityEvent<T> {
    const nextSeq = (this.teamSequenceNumbers.get(teamId) || 0) + 1;
    this.teamSequenceNumbers.set(teamId, nextSeq);

    // Sanitize payload: strip any raw DB internals or credentials
    const cleanPayload = this.sanitizePayload(rawPayload);

    const event: ActivityEvent<T> = {
      id: `evt_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
      sequenceNumber: nextSeq,
      teamId,
      eventType,
      actorId,
      payload: cleanPayload,
      timestamp: new Date().toISOString(),
    };

    // Store in ring buffer for reconnection replay
    if (!this.teamEventBuffers.has(teamId)) {
      this.teamEventBuffers.set(teamId, []);
    }
    const buffer = this.teamEventBuffers.get(teamId)!;
    buffer.push(event);
    if (buffer.length > this.maxBufferSize) {
      buffer.shift();
    }

    // Broadcast to team channel subscribers
    const subscribers = this.teamSubscribers.get(teamId);
    if (subscribers) {
      for (const sub of subscribers) {
        try {
          sub.send(event);
        } catch {
          // Socket write failed, will be cleaned up on disconnect
        }
      }
    }

    return event;
  }

  // Subscribe a client socket to a team channel
  subscribe(teamId: string, subscriber: IActivityFeedSubscriber): void {
    if (!this.teamSubscribers.has(teamId)) {
      this.teamSubscribers.set(teamId, new Set());
    }
    this.teamSubscribers.get(teamId)!.add(subscriber);
  }

  // Unsubscribe a client socket
  unsubscribe(teamId: string, subscriber: IActivityFeedSubscriber): void {
    const subs = this.teamSubscribers.get(teamId);
    if (subs) {
      subs.delete(subscriber);
      if (subs.size === 0) {
        this.teamSubscribers.delete(teamId);
      }
    }
  }

  // Unsubscribe client from all channels on disconnect
  unsubscribeAll(subscriber: IActivityFeedSubscriber): void {
    for (const [teamId, subs] of this.teamSubscribers.entries()) {
      if (subs.has(subscriber)) {
        subs.delete(subscriber);
        if (subs.size === 0) {
          this.teamSubscribers.delete(teamId);
        }
      }
    }
  }

  // Retrieve missed events since a specific sequence number for reconnection recovery
  getEventsSince(
    teamId: string,
    sinceSequenceNumber: number,
  ): { events: ActivityEvent[]; historyTruncated: boolean } {
    const buffer = this.teamEventBuffers.get(teamId) || [];
    if (buffer.length === 0) {
      return { events: [], historyTruncated: false };
    }
    const oldestSeq = buffer[0].sequenceNumber;
    const historyTruncated = sinceSequenceNumber < oldestSeq - 1;
    const events = buffer.filter((evt) => evt.sequenceNumber > sinceSequenceNumber);
    return { events, historyTruncated };
  }

  // Get current active subscriber count for monitoring
  getSubscriberCount(teamId: string): number {
    return this.teamSubscribers.get(teamId)?.size || 0;
  }

  private sanitizePayload<T>(payload: T): T {
    if (!payload || typeof payload !== 'object') return payload;
    const sanitized: any = Array.isArray(payload) ? [] : {};
    for (const [key, value] of Object.entries(payload)) {
      // Strip sensitive database columns, passwords, tokens, secrets, API keys, and hashes
      const lowerKey = key.toLowerCase();
      if (
        !lowerKey.includes('password') &&
        !lowerKey.includes('secret') &&
        !lowerKey.includes('token') &&
        !lowerKey.includes('hash') &&
        !lowerKey.includes('api_key') &&
        !lowerKey.includes('apikey') &&
        !lowerKey.includes('private')
      ) {
        if (value && typeof value === 'object') {
          sanitized[key] = this.sanitizePayload(value);
        } else {
          sanitized[key] = value;
        }
      }
    }
    return sanitized;
  }
}
