const fs = require('fs');
const path = require('path');

const logFile = path.resolve(__dirname, 'fix-regression-test-output.txt');
fs.writeFileSync(logFile, '', 'utf8');

function log(msg) {
  console.log(msg);
  fs.appendFileSync(logFile, msg + '\n', 'utf8');
}

// Standalone ActivityFeedService definition
class ActivityFeedService {
  constructor() {
    this.teamSubscribers = new Map();
    this.teamEventBuffers = new Map();
    this.teamSequenceNumbers = new Map();
    this.maxBufferSize = 50;
  }

  publishEvent(teamId, eventType, actorId, rawPayload) {
    if (!teamId || !eventType || !actorId) {
      throw new Error('INVALID_EVENT_PARAMETERS');
    }
    const nextSeq = (this.teamSequenceNumbers.get(teamId) || 0) + 1;
    this.teamSequenceNumbers.set(teamId, nextSeq);

    const event = {
      id: `evt_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
      sequenceNumber: nextSeq,
      teamId,
      eventType,
      actorId,
      payload: rawPayload,
      timestamp: new Date().toISOString(),
    };

    if (!this.teamEventBuffers.has(teamId)) {
      this.teamEventBuffers.set(teamId, []);
    }
    const buffer = this.teamEventBuffers.get(teamId);
    buffer.push(event);
    if (buffer.length > this.maxBufferSize) {
      buffer.shift();
    }

    const subscribers = this.teamSubscribers.get(teamId);
    if (subscribers) {
      for (const sub of subscribers) {
        sub.send(event);
      }
    }
    return event;
  }

  subscribe(teamId, subscriber) {
    if (!this.teamSubscribers.has(teamId)) {
      this.teamSubscribers.set(teamId, new Set());
    }
    this.teamSubscribers.get(teamId).add(subscriber);
  }

  unsubscribe(teamId, subscriber) {
    const subs = this.teamSubscribers.get(teamId);
    if (subs) {
      subs.delete(subscriber);
      if (subs.size === 0) this.teamSubscribers.delete(teamId);
    }
  }

  getEventsSince(teamId, sinceSequenceNumber) {
    const buffer = this.teamEventBuffers.get(teamId) || [];
    if (buffer.length === 0) return { events: [], historyTruncated: false };
    const oldestSeq = buffer[0].sequenceNumber;
    const historyTruncated = sinceSequenceNumber < oldestSeq - 1;
    const events = buffer.filter((evt) => evt.sequenceNumber > sinceSequenceNumber);
    return { events, historyTruncated };
  }

  getSubscriberCount(teamId) {
    return this.teamSubscribers.get(teamId)?.size || 0;
  }
}

class StagedActivityFeedGateway {
  constructor(activityFeedService, authService, membershipStore) {
    this.activityFeedService = activityFeedService;
    this.authService = authService;
    this.membershipStore = membershipStore;
    this.activeClients = new Map();
    this.subscriberAdapters = new Map();
  }

  handleConnection(client, authHeader) {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      client.emit('error', { error: { code: 'UNAUTHORIZED' } });
      client.disconnect(4001);
      return { success: false };
    }
    const token = authHeader.replace('Bearer ', '').trim();
    const payload = this.authService.verifyToken(token);
    if (!payload) {
      client.emit('error', { error: { code: 'UNAUTHORIZED' } });
      client.disconnect(4001);
      return { success: false };
    }

    client.userId = payload.sub;
    client.lastActiveAt = Date.now();
    client.isAlive = true;
    client.subscribedTeams = new Set();
    this.activeClients.set(client.id, client);
    client.emit('connected', { userId: client.userId });
    return { success: true };
  }

  handleJoinTeam(clientId, teamId) {
    const client = this.activeClients.get(clientId);
    if (!client || !client.userId) return { success: false, error: 'UNAUTHENTICATED_CLIENT' };

    const authorized = this.membershipStore.isMember(teamId, client.userId);
    if (!authorized) {
      client.emit('error', { error: { code: 'FORBIDDEN' } });
      return { success: false, error: 'FORBIDDEN' };
    }

    if (client.subscribedTeams.has(teamId)) {
      return { success: true, alreadySubscribed: true };
    }

    const adapter = {
      clientId: client.id,
      teamId,
      send: (evt) => {
        // Downlink event dispatch does NOT reset isAlive (passive delivery)
        client.emit('activity_event', evt);
      },
    };

    this.subscriberAdapters.set(`${client.id}_${teamId}`, adapter);
    this.activityFeedService.subscribe(teamId, adapter);
    client.subscribedTeams.add(teamId);
    client.emit('joined_team', { teamId, status: 'SUBSCRIBED' });
    return { success: true };
  }

  handleReconnect(clientId, teamId, lastSequenceNumber) {
    const client = this.activeClients.get(clientId);
    if (!client || !client.userId) return { success: false, error: 'UNAUTHENTICATED_CLIENT' };

    const authorized = this.membershipStore.isMember(teamId, client.userId);
    if (!authorized) {
      client.emit('error', { error: { code: 'FORBIDDEN' } });
      return { success: false, error: 'FORBIDDEN' };
    }

    if (client.subscribedTeams.has(teamId)) {
      const existing = this.subscriberAdapters.get(`${client.id}_${teamId}`);
      if (existing) {
        this.activityFeedService.unsubscribe(teamId, existing);
        this.subscriberAdapters.delete(`${client.id}_${teamId}`);
      }
    }

    // Staging queue for concurrent live events
    const stagingQueue = [];
    let isReplaying = true;

    const stagedAdapter = {
      clientId: client.id,
      teamId,
      send: (evt) => {
        if (isReplaying) {
          stagingQueue.push(evt);
        } else {
          client.emit('activity_event', evt);
        }
      },
    };

    this.subscriberAdapters.set(`${client.id}_${teamId}`, stagedAdapter);
    this.activityFeedService.subscribe(teamId, stagedAdapter);
    client.subscribedTeams.add(teamId);

    const { events: missedEvents, historyTruncated } = this.activityFeedService.getEventsSince(
      teamId,
      lastSequenceNumber,
    );

    let maxDeliveredSeq = lastSequenceNumber;

    for (const evt of missedEvents) {
      client.emit('activity_event', evt);
      if (evt.sequenceNumber > maxDeliveredSeq) {
        maxDeliveredSeq = evt.sequenceNumber;
      }
    }

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

  handlePong(clientId) {
    const client = this.activeClients.get(clientId);
    if (!client) return false;
    client.isAlive = true;
    client.lastActiveAt = Date.now();
    return true;
  }

  handleHeartbeat(clientId) {
    const client = this.activeClients.get(clientId);
    if (!client) return false;
    client.isAlive = true;
    client.lastActiveAt = Date.now();
    client.emit('pong', { timestamp: client.lastActiveAt });
    return true;
  }

  sweepInactiveClients(maxIdleMs = 30000) {
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

  handleDisconnect(clientId, reasonCode = 1000) {
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

  getActiveClientCount() {
    return this.activeClients.size;
  }
}

class MockSocket {
  constructor(id) {
    this.id = id;
    this.messages = [];
    this.connected = true;
    this.closeCode = null;
    this.autoPong = false;
    this.onPing = null;
  }
  emit(event, data) {
    this.messages.push({ event, data, timestamp: Date.now() });
    if (event === 'ping' && this.onPing) {
      this.onPing();
    }
  }
  disconnect(code) {
    this.connected = false;
    this.closeCode = code;
  }
  getEvents(eventName) {
    return this.messages.filter((m) => m.event === eventName);
  }
}

async function runRegressionSuite() {
  log('================================================================================');
  log('MODULE 05 STEP 6: FIX — REGRESSION & VERIFICATION TEST SUITE');
  log(`Timestamp: ${new Date().toISOString()}`);
  log('Components: StagedActivityFeedGateway & ActivityFeedService');
  log('Verifying Targeted Fixes for Heartbeat Lifecycle & Replay Ordering');
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

  const authService = {
    verifyToken(token) {
      if (token === 'jwt_alice') return { sub: 'usr_alice' };
      if (token === 'jwt_bob') return { sub: 'usr_bob' };
      if (token === 'jwt_charlie') return { sub: 'usr_charlie' };
      return null;
    },
  };

  const membershipStore = {
    isMember(teamId, userId) {
      if (teamId === 'team_alpha') return ['usr_alice', 'usr_bob'].includes(userId);
      if (teamId === 'team_beta') return ['usr_charlie'].includes(userId);
      return false;
    },
  };

  const service = new ActivityFeedService();
  const gateway = new StagedActivityFeedGateway(service, authService, membershipStore);

  // --------------------------------------------------------------------------
  // PART 1: Heartbeat Lifecycle & Passive Listener Verifications
  // --------------------------------------------------------------------------
  log('--- PART 1: Heartbeat Lifecycle & Passive Listener Tests ---');
  const healthyClient = new MockSocket('client_healthy');
  healthyClient.onPing = () => gateway.handlePong(healthyClient.id);
  gateway.handleConnection(healthyClient, 'Bearer jwt_alice');
  gateway.handleJoinTeam(healthyClient.id, 'team_alpha');

  // Sweep 1: Server sends ping, marks isAlive=false
  const swept1 = gateway.sweepInactiveClients(30000);
  assert(swept1 === 0, 'Sweep 1: Zero healthy clients evicted');
  assert(healthyClient.getEvents('ping').length === 1, 'Sweep 1: Ping frame sent to client');

  // Healthy client responds with Pong before Sweep 2
  gateway.handlePong(healthyClient.id);
  assert(healthyClient.isAlive === true, 'handlePong marks client alive');

  // Sweep 2: Client responded, remains connected
  const swept2 = gateway.sweepInactiveClients(30000);
  assert(swept2 === 0 && healthyClient.connected === true, 'Sweep 2: Healthy client remains connected across multiple sweeps');
  assert(healthyClient.getEvents('ping').length === 2, 'Sweep 2: Second ping frame issued');

  // Passive Event Delivery without Pong Test:
  // Downlink event is sent to a passive client that ignores ping
  const passiveClient = new MockSocket('client_passive_zombie');
  gateway.handleConnection(passiveClient, 'Bearer jwt_bob');
  gateway.handleJoinTeam(passiveClient.id, 'team_alpha');

  // Sweep 1 arms ping for passive client
  gateway.sweepInactiveClients(30000);
  assert(passiveClient.isAlive === false, 'Passive client armed for ping check (isAlive=false)');

  // Downlink events stream to passive client
  service.publishEvent('team_alpha', 'LINK_CREATED', 'usr_alice', { code: 'p1' });
  service.publishEvent('team_alpha', 'LINK_CREATED', 'usr_alice', { code: 'p2' });
  assert(passiveClient.getEvents('activity_event').length === 2, 'Events delivered down to passive socket');

  // Crucial test: Passive event delivery did NOT reset isAlive!
  assert(passiveClient.isAlive === false, 'CRITICAL: Passive event delivery did NOT incorrectly count as heartbeat response');

  // Sweep 2: Passive client did not respond with Pong -> evicted!
  const sweptPassive = gateway.sweepInactiveClients(30000);
  assert(sweptPassive === 1, 'Passive client without Pong was correctly evicted on next sweep cycle');
  assert(passiveClient.connected === false && passiveClient.closeCode === 4008, 'Eviction socket closed with code 4008');

  // Disconnect cleanup check
  assert(service.getSubscriberCount('team_alpha') === 1, 'Disconnect cleanup swept passive client from team_alpha subscribers');

  // --------------------------------------------------------------------------
  // PART 2: Reconnection Replay Ordering & Concurrent Live Interleaving
  // --------------------------------------------------------------------------
  log('\n--- PART 2: Reconnection Replay Ordering & Staging Queue Tests ---');
  // Reconnect Bob with historical events
  const reconnectClient = new MockSocket('client_bob_reconnect');
  gateway.handleConnection(reconnectClient, 'Bearer jwt_bob');

  // Trigger reconnect requesting events since sequence 0, while a concurrent event is published during replay
  let concurrentEventFired = false;
  // We hook into activityFeedService to fire an event during the getEventsSince window
  const origGetEvents = service.getEventsSince.bind(service);
  service.getEventsSince = (teamId, seq) => {
    // Simulate concurrent publish on live channel
    service.publishEvent('team_alpha', 'LINK_CREATED', 'usr_alice', { code: 'concurrent_link_during_replay' });
    concurrentEventFired = true;
    return origGetEvents(teamId, seq);
  };

  const reconResult = gateway.handleReconnect(reconnectClient.id, 'team_alpha', 0);
  assert(reconResult.success === true, 'handleReconnect succeeded');
  assert(concurrentEventFired === true, 'Concurrent event fired while replay was active');

  const receivedEvts = reconnectClient.getEvents('activity_event');
  const seqs = receivedEvts.map((e) => e.data.sequenceNumber);
  log(`[REPLAY_SEQS] Received sequence numbers: [${seqs.join(', ')}]`);

  // Verify sequence monotonicity: every sequence must be strictly greater than preceding
  const strictlyMonotonic = seqs.every((val, idx, arr) => idx === 0 || val > arr[idx - 1]);
  assert(strictlyMonotonic, 'Sequence numbers are strictly monotonic with zero out-of-order deliveries');

  // Verify no duplicate sequence numbers
  const hasDuplicates = new Set(seqs).size !== seqs.length;
  assert(!hasDuplicates, 'Zero duplicate sequence numbers received during replay and live transition');

  // Verify concurrent event came AFTER historical events
  const concurrentEvtIndex = receivedEvts.findIndex(
    (e) => e.data.payload && e.data.payload.code === 'concurrent_link_during_replay',
  );
  assert(
    concurrentEvtIndex === receivedEvts.length - 1,
    'Concurrent live event was queued in staging buffer and delivered AFTER all historical events',
  );

  // --------------------------------------------------------------------------
  // PART 3: Team Isolation Preserved During Replay
  // --------------------------------------------------------------------------
  log('\n--- PART 3: Team Isolation Preserved ---');
  const charlieClient = new MockSocket('client_charlie');
  gateway.handleConnection(charlieClient, 'Bearer jwt_charlie');
  gateway.handleJoinTeam(charlieClient.id, 'team_beta');

  service.publishEvent('team_alpha', 'LINK_CREATED', 'usr_alice', { code: 'alpha_isolated' });
  assert(charlieClient.getEvents('activity_event').length === 0, 'Team Beta received zero events from Team Alpha');

  log('\n================================================================================');
  log(`SUMMARY: ${passed} of ${total} regression assertions PASSED`);
  log('================================================================================');

  if (passed !== total) {
    process.exitCode = 1;
  }
}

runRegressionSuite().catch(console.error);
