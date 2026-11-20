import { ActivityFeedService, ActivityEvent, IActivityFeedSubscriber } from './activity-feed.service';

export interface IAuthService {
  verifyToken(token: string): { sub: string; email: string } | null;
}

export interface ITeamMembershipStore {
  isMember(teamId: string, userId: string): boolean;
}

export interface ISocketConnection {
  id: string;
  userId?: string;
  lastActiveAt: number;
  isAlive: boolean;
  subscribedTeams: Set<string>;
  emit(event: string, data: unknown): void;
  disconnect(closeCode?: number): void;
}

export class ActivityFeedGateway {
  private activeClients: Map<string, ISocketConnection> = new Map();
  private subscriberAdapters: Map<string, IActivityFeedSubscriber> = new Map();
  private heartbeatIntervalTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly activityFeedService: ActivityFeedService,
    private readonly authService: IAuthService,
    private readonly membershipStore: ITeamMembershipStore,
  ) {}

  // 1. Connection Lifecycle: Authentication on Handshake
  handleConnection(client: ISocketConnection, authHeader?: string): { success: boolean; error?: string } {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      client.emit('error', {
        error: {
          code: 'UNAUTHORIZED',
          message: 'Missing or malformed Authorization bearer token',
        },
      });
      client.disconnect(4001);
      return { success: false, error: 'UNAUTHORIZED' };
    }

    const token = authHeader.replace('Bearer ', '').trim();
    const payload = this.authService.verifyToken(token);
    if (!payload) {
      client.emit('error', {
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid or expired JWT token',
        },
      });
      client.disconnect(4001);
      return { success: false, error: 'INVALID_TOKEN' };
    }

    client.userId = payload.sub;
    client.lastActiveAt = Date.now();
    client.isAlive = true;
    client.subscribedTeams = new Set();

    this.activeClients.set(client.id, client);
    client.emit('connected', { userId: client.userId, timestamp: new Date().toISOString() });

    return { success: true };
  }

  // 2. Team-Scoped Channel Authorization: join_team
  handleJoinTeam(clientId: string, teamId: string): { success: boolean; error?: string } {
    const client = this.activeClients.get(clientId);
    if (!client || !client.userId) {
      return { success: false, error: 'UNAUTHENTICATED_CLIENT' };
    }

    // Authorization verification: verify user is actually an active team member
    const authorized = this.membershipStore.isMember(teamId, client.userId);
    if (!authorized) {
      client.emit('error', {
        error: {
          code: 'FORBIDDEN',
          message: `User '${client.userId}' is not a member of team '${teamId}'`,
        },
      });
      return { success: false, error: 'FORBIDDEN' };
    }

    // Guard against duplicate subscription on the same socket
    if (client.subscribedTeams.has(teamId)) {
      return { success: true };
    }

    // Subscribe to feed service
    const subscriberAdapter: IActivityFeedSubscriber = {
      clientId: client.id,
      teamId,
      send: (event: ActivityEvent) => {
        client.emit('activity_event', event);
      },
    };

    this.subscriberAdapters.set(`${client.id}_${teamId}`, subscriberAdapter);
    this.activityFeedService.subscribe(teamId, subscriberAdapter);
    client.subscribedTeams.add(teamId);

    client.emit('joined_team', {
      teamId,
      status: 'SUBSCRIBED',
      timestamp: new Date().toISOString(),
    });

    return { success: true };
  }

  // 3. Reconnection & Missed Event Replay: reconnect_team
  handleReconnect(
    clientId: string,
    teamId: string,
    lastSequenceNumber: number,
  ): { success: boolean; replayedEventsCount: number; historyTruncated: boolean; error?: string } {
    const client = this.activeClients.get(clientId);
    if (!client || !client.userId) {
      return { success: false, replayedEventsCount: 0, historyTruncated: false, error: 'UNAUTHENTICATED_CLIENT' };
    }

    const authorized = this.membershipStore.isMember(teamId, client.userId);
    if (!authorized) {
      client.emit('error', {
        error: {
          code: 'FORBIDDEN',
          message: `User '${client.userId}' is not a member of team '${teamId}'`,
        },
      });
      return { success: false, replayedEventsCount: 0, historyTruncated: false, error: 'FORBIDDEN' };
    }

    // Clean up any stale subscription for this team on this client
    if (client.subscribedTeams.has(teamId)) {
      const existingAdapter = this.subscriberAdapters.get(`${client.id}_${teamId}`);
      if (existingAdapter) {
        this.activityFeedService.unsubscribe(teamId, existingAdapter);
        this.subscriberAdapters.delete(`${client.id}_${teamId}`);
      }
    }

    // Staging queue to hold concurrent live events arriving during replay phase
    const stagingQueue: ActivityEvent[] = [];
    let isReplaying = true;

    const stagedAdapter: IActivityFeedSubscriber = {
      clientId: client.id,
      teamId,
      send: (event: ActivityEvent) => {
        if (isReplaying) {
          stagingQueue.push(event);
        } else {
          client.emit('activity_event', event);
        }
      },
    };

    // Attach staged adapter to live feed BEFORE fetching historical buffer
    // This ensures no events are lost in the transition window
    this.subscriberAdapters.set(`${client.id}_${teamId}`, stagedAdapter);
    this.activityFeedService.subscribe(teamId, stagedAdapter);
    client.subscribedTeams.add(teamId);

    // Fetch missed events from the historical buffer
    const { events: missedEvents, historyTruncated } = this.activityFeedService.getEventsSince(
      teamId,
      lastSequenceNumber,
    );

    let maxDeliveredSeq = lastSequenceNumber;

    // Deliver historical events in chronological order
    for (const evt of missedEvents) {
      client.emit('activity_event', evt);
      if (evt.sequenceNumber > maxDeliveredSeq) {
        maxDeliveredSeq = evt.sequenceNumber;
      }
    }

    // Flush staging queue in sequence order, deduplicating any overlapping events
    for (const stagedEvt of stagingQueue) {
      if (stagedEvt.sequenceNumber > maxDeliveredSeq) {
        client.emit('activity_event', stagedEvt);
        maxDeliveredSeq = stagedEvt.sequenceNumber;
      }
    }

    isReplaying = false;

    client.emit('reconnect_complete', {
      teamId,
      replayedCount: missedEvents.length,
      historyTruncated,
      currentSequence: maxDeliveredSeq,
    });

    return { success: true, replayedEventsCount: missedEvents.length, historyTruncated };
  }

  // 4. Heartbeat Protocol: ping / pong
  handlePong(clientId: string): boolean {
    const client = this.activeClients.get(clientId);
    if (!client) return false;

    client.isAlive = true;
    client.lastActiveAt = Date.now();
    return true;
  }

  handleHeartbeat(clientId: string): boolean {
    const client = this.activeClients.get(clientId);
    if (!client) return false;

    client.isAlive = true;
    client.lastActiveAt = Date.now();
    client.emit('pong', { timestamp: client.lastActiveAt });
    return true;
  }

  // Sweeps inactive zombie connections & broadcasts ping control frames
  sweepInactiveClients(maxIdleMs = 30000): number {
    const now = Date.now();
    let disconnectedCount = 0;

    for (const [clientId, client] of this.activeClients.entries()) {
      if (!client.isAlive || now - client.lastActiveAt > maxIdleMs) {
        this.handleDisconnect(clientId, 4008);
        disconnectedCount++;
      } else {
        client.isAlive = false;
        client.emit('ping', { timestamp: now });
      }
    }

    return disconnectedCount;
  }

  // 5. Connection Disconnect & State Cleanup
  handleDisconnect(clientId: string, reasonCode = 1000): void {
    const client = this.activeClients.get(clientId);
    if (!client) return;

    for (const teamId of client.subscribedTeams) {
      const adapter = this.subscriberAdapters.get(`${client.id}_${teamId}`);
      if (adapter) {
        this.activityFeedService.unsubscribe(teamId, adapter);
        this.subscriberAdapters.delete(`${client.id}_${teamId}`);
      }
    }

    client.disconnect(reasonCode);
    this.activeClients.delete(clientId);
  }

  getActiveClientCount(): number {
    return this.activeClients.size;
  }
}
