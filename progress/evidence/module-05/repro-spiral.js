const fs = require('fs');
const path = require('path');

const logFile = path.resolve(__dirname, 'spiral-repro-log.txt');
fs.writeFileSync(logFile, '', 'utf8');

function log(msg) {
  console.log(msg);
  fs.appendFileSync(logFile, msg + '\n', 'utf8');
}

log('================================================================================');
log('MODULE 05 STEP 5: BREAK — REPRODUCING THE ITERATION SPIRAL');
log(`Timestamp: ${new Date().toISOString()}`);
log('Component: ActivityFeedGateway & ActivityFeedService (Round 3 Implementation)');
log('Target Defect: Silent WebSocket Disconnection & Heartbeat Event Stream Collision');
log('================================================================================\n');

// ----------------------------------------------------------------------------
// Round 3 Implementation Model (Showing Context Pollution & Regression)
// ----------------------------------------------------------------------------

class Round3ActivityFeedService {
  constructor() {
    this.teamSubscribers = new Map();
    this.teamEventBuffers = new Map();
    this.teamSequenceNumbers = new Map();
  }

  publishEvent(teamId, eventType, actorId, payload) {
    const nextSeq = (this.teamSequenceNumbers.get(teamId) || 0) + 1;
    this.teamSequenceNumbers.set(teamId, nextSeq);

    const event = {
      id: `evt_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      sequenceNumber: nextSeq,
      teamId,
      eventType,
      actorId,
      payload,
      timestamp: new Date().toISOString(),
    };

    if (!this.teamEventBuffers.has(teamId)) {
      this.teamEventBuffers.set(teamId, []);
    }
    this.teamEventBuffers.get(teamId).push(event);

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
    return buffer.filter((e) => e.sequenceNumber > sinceSequenceNumber);
  }
}

class Round3ActivityFeedGateway {
  constructor(service) {
    this.service = service;
    this.activeClients = new Map();
    this.subscriberAdapters = new Map();
  }

  handleConnection(client, authHeader) {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      client.disconnect(4001);
      return false;
    }
    client.userId = 'usr_alice';
    client.lastActiveAt = Date.now();
    client.isAlive = true; // Initialized to true in Round 3
    client.subscribedTeams = new Set();
    this.activeClients.set(client.id, client);
    client.emit('connected', { userId: client.userId });
    return true;
  }

  handleJoinTeam(clientId, teamId) {
    const client = this.activeClients.get(clientId);
    if (!client) return false;

    // Round 3 Bug: No idempotency check. Re-joining or reconnecting adds duplicate adapters!
    const adapter = {
      clientId: client.id,
      teamId,
      send: (evt) => {
        // Round 3 Flaw: Does NOT update client.lastActiveAt or client.isAlive!
        client.emit('activity_event', evt);
      },
    };

    this.subscriberAdapters.set(`${client.id}_${teamId}`, adapter);
    this.service.subscribe(teamId, adapter);
    client.subscribedTeams.add(teamId);
    return true;
  }

  // Heartbeat sweep added in Round 3
  sweepInactiveClients(maxIdleMs = 30000) {
    const now = Date.now();
    let disconnected = 0;

    for (const [clientId, client] of this.activeClients.entries()) {
      // The Round 3 Flaw: If client hasn't sent ping, client.isAlive is false!
      // Even if events are flowing TO the client, !client.isAlive triggers silent disconnect!
      if (now - client.lastActiveAt > maxIdleMs || !client.isAlive) {
        log(`[SWEEP_EVICT] Client '${clientId}' evicted: isAlive=${client.isAlive}, idleMs=${now - client.lastActiveAt}`);
        this.handleDisconnect(clientId, 4008);
        disconnected++;
      } else {
        log(`[SWEEP_MARK] Client '${clientId}' marked isAlive=false for next cycle`);
        client.isAlive = false; // Toggled false! Requires client ping to recover
      }
    }
    return disconnected;
  }

  // Round 3 Reconnection Logic with Race Condition
  handleReconnect(clientId, teamId, lastSeq, onConcurrentEvent) {
    // Round 3 connects live subscription BEFORE replay finishes
    this.handleJoinTeam(clientId, teamId);

    if (onConcurrentEvent) {
      log('[RACE_SIMULATION] Simulating concurrent event published during replay phase...');
      onConcurrentEvent();
    }

    const missed = this.service.getEventsSince(teamId, lastSeq);
    const client = this.activeClients.get(clientId);
    for (const evt of missed) {
      client.emit('activity_event', evt);
    }
  }

  handleDisconnect(clientId, code = 1000) {
    const client = this.activeClients.get(clientId);
    if (!client) return;
    for (const teamId of client.subscribedTeams) {
      const adapter = this.subscriberAdapters.get(`${client.id}_${teamId}`);
      if (adapter) {
        this.service.unsubscribe(teamId, adapter);
        this.subscriberAdapters.delete(`${client.id}_${teamId}`);
      }
    }
    client.disconnect(code);
    this.activeClients.delete(clientId);
  }
}

class MockSocket {
  constructor(id) {
    this.id = id;
    this.messages = [];
    this.connected = true;
    this.closeCode = null;
  }

  emit(event, data) {
    this.messages.push({ event, data, timestamp: Date.now() });
  }

  disconnect(code) {
    this.connected = false;
    this.closeCode = code;
  }

  getEvents(eventName) {
    return this.messages.filter((m) => m.event === eventName);
  }
}

// ----------------------------------------------------------------------------
// Execution of Defect Reproduction
// ----------------------------------------------------------------------------

async function reproduceDefects() {
  log('--- TEST 1: Reproducing Silent WebSocket Disconnection After First Event ---');
  const service = new Round3ActivityFeedService();
  const gateway = new Round3ActivityFeedGateway(service);

  const client = new MockSocket('client_desktop_user');
  gateway.handleConnection(client, 'Bearer jwt_alice');
  gateway.handleJoinTeam(client.id, 'team_alpha');

  log(`[STATE] Client '${client.id}' connected: connected=${client.connected}, isAlive=${client.isAlive}`);

  // Event 1 is published and delivered successfully
  service.publishEvent('team_alpha', 'LINK_CREATED', 'usr_alice', { code: 'lnk_1' });
  const evts1 = client.getEvents('activity_event');
  log(`[EVENT_DELIVERY] First event delivered: count=${evts1.length}, seq=${evts1[0].data.sequenceNumber}`);

  // Server heartbeat sweep runs Cycle 1 (e.g. at T=15s)
  log('\n[HEARTBEAT_CYCLE_1] Server executes first sweep...');
  gateway.sweepInactiveClients(30000);
  log(`[STATE] After Cycle 1: client.connected=${client.connected}, client.isAlive=${client.isAlive}`);

  // More events published. Client receives them, but client is a listener and has not sent a ping packet.
  service.publishEvent('team_alpha', 'LINK_CREATED', 'usr_bob', { code: 'lnk_2' });

  // Server heartbeat sweep runs Cycle 2 (e.g. at T=30s, still under 30s idle time!)
  log('\n[HEARTBEAT_CYCLE_2] Server executes second sweep...');
  const evictedCount = gateway.sweepInactiveClients(30000);

  log(`\n[REPRODUCTION_EVIDENCE]:`);
  log(`- Client connected state: ${client.connected}`);
  log(`- Disconnect close code: ${client.closeCode}`);
  log(`- Total evicted clients: ${evictedCount}`);

  if (client.connected === false && client.closeCode === 4008) {
    log('[CONFIRMED_DEFECT_1] SILENT DISCONNECT REPRODUCED: Active listener was terminated by heartbeat sweep despite active event flow!');
  }

  // --- TEST 2: Reproducing Reconnection Out-of-Order Race Condition ---
  log('\n--- TEST 2: Reproducing Reconnection Replay Out-of-Order Race Condition ---');
  const service2 = new Round3ActivityFeedService();
  const gateway2 = new Round3ActivityFeedGateway(service2);

  // Seed events 1, 2, 3
  service2.publishEvent('team_alpha', 'LINK_CREATED', 'usr_alice', { code: 'lnk_1' });
  service2.publishEvent('team_alpha', 'LINK_CREATED', 'usr_alice', { code: 'lnk_2' });
  service2.publishEvent('team_alpha', 'LINK_CREATED', 'usr_alice', { code: 'lnk_3' });

  const clientReconnecting = new MockSocket('client_reconnecting');
  gateway2.handleConnection(clientReconnecting, 'Bearer jwt_alice');

  log('[RECONNECT] Client reconnecting with lastSequenceNumber = 1 (expecting seq 2, 3)...');

  // Trigger reconnect, while simultaneously another user publishes event 4 during replay
  gateway2.handleReconnect(clientReconnecting.id, 'team_alpha', 1, () => {
    service2.publishEvent('team_alpha', 'LINK_CREATED', 'usr_charlie', { code: 'lnk_4_concurrent' });
  });

  const receivedEvts = clientReconnecting.getEvents('activity_event');
  const receivedSeqs = receivedEvts.map((e) => e.data.sequenceNumber);
  log(`[RECEIVED_SEQUENCE] Observed sequence numbers at client: [${receivedSeqs.join(', ')}]`);

  if (receivedSeqs[0] === 4 && receivedSeqs[1] === 2 && receivedSeqs[2] === 3) {
    log('[CONFIRMED_DEFECT_2] OUT-OF-ORDER REPLAY REPRODUCED: Live event (seq 4) arrived BEFORE replayed events (seq 2, 3)!');
  } else if (receivedSeqs.length > 0 && receivedSeqs.some((val, idx, arr) => idx > 0 && val < arr[idx - 1])) {
    log('[CONFIRMED_DEFECT_2] OUT-OF-ORDER REPLAY REPRODUCED: Event ordering inverted!');
  }

  log('\n================================================================================');
  log('REPRODUCTION COMPLETE: Both regressions empirically demonstrated.');
  log('================================================================================');
}

reproduceDefects().catch(console.error);
