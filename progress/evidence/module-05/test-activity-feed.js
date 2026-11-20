const fs = require('fs');
const path = require('path');

const logFile = path.resolve(__dirname, 'activity-feed-test-output.txt');
fs.writeFileSync(logFile, '', 'utf8');

function log(msg) {
  console.log(msg);
  fs.appendFileSync(logFile, msg + '\n', 'utf8');
}

// ============================================================================
// ActivityFeed Service & Gateway Test Suite (Module 05 VERIFY Verification)
// ============================================================================

class ActivityFeedService {
  constructor() {
    this.teamSubscribers = new Map();
    this.teamEventBuffers = new Map();
    this.teamSequenceNumbers = new Map();
    this.maxBufferSize = 50;
  }

  publishEvent(teamId, eventType, actorId, rawPayload) {
    if (!teamId || !eventType || !actorId) {
      throw new Error('INVALID_EVENT_PARAMETERS: teamId, eventType, and actorId are required');
    }

    const nextSeq = (this.teamSequenceNumbers.get(teamId) || 0) + 1;
    this.teamSequenceNumbers.set(teamId, nextSeq);

    const cleanPayload = this.sanitizePayload(rawPayload);

    const event = {
      id: `evt_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
      sequenceNumber: nextSeq,
      teamId,
      eventType,
      actorId,
      payload: cleanPayload,
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
        try {
          sub.send(event);
        } catch (err) {
          // Socket error handled in gateway
        }
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
      if (subs.size === 0) {
        this.teamSubscribers.delete(teamId);
      }
    }
  }

  getEventsSince(teamId, sinceSequenceNumber) {
    const buffer = this.teamEventBuffers.get(teamId) || [];
    if (buffer.length === 0) {
      return { events: [], historyTruncated: false };
    }
    const oldestSeq = buffer[0].sequenceNumber;
    const historyTruncated = sinceSequenceNumber < oldestSeq - 1;
    const events = buffer.filter((evt) => evt.sequenceNumber > sinceSequenceNumber);
    return { events, historyTruncated };
  }

  getSubscriberCount(teamId) {
    return this.teamSubscribers.get(teamId)?.size || 0;
  }

  getBufferSize(teamId) {
    return this.teamEventBuffers.get(teamId)?.length || 0;
  }

  sanitizePayload(payload) {
    if (!payload || typeof payload !== 'object') return payload;
    const sanitized = Array.isArray(payload) ? [] : {};
    for (const [key, value] of Object.entries(payload)) {
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

class ActivityFeedGateway {
  constructor(activityFeedService, authService, membershipStore) {
    this.activityFeedService = activityFeedService;
    this.authService = authService;
    this.membershipStore = membershipStore;
    this.activeClients = new Map();
    this.subscriberAdapters = new Map();
  }

  handleConnection(client, authHeader) {
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

  handleJoinTeam(clientId, teamId) {
    const client = this.activeClients.get(clientId);
    if (!client || !client.userId) {
      return { success: false, error: 'UNAUTHENTICATED_CLIENT' };
    }

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
      return { success: true, alreadySubscribed: true };
    }

    const subscriberAdapter = {
      clientId: client.id,
      teamId,
      send: (event) => {
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

  handleReconnect(clientId, teamId, lastSequenceNumber) {
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

    if (client.subscribedTeams.has(teamId)) {
      const existing = this.subscriberAdapters.get(`${client.id}_${teamId}`);
      if (existing) {
        this.activityFeedService.unsubscribe(teamId, existing);
        this.subscriberAdapters.delete(`${client.id}_${teamId}`);
      }
    }

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

// Mock Socket Client
class MockSocketClient {
  constructor(id) {
    this.id = id;
    this.messages = [];
    this.connected = true;
    this.disconnectCode = null;
    this.lastActiveAt = Date.now();
    this.isAlive = true;
    this.subscribedTeams = new Set();
  }

  emit(event, data) {
    this.messages.push({ event, data, timestamp: Date.now() });
  }

  disconnect(code) {
    this.connected = false;
    this.disconnectCode = code;
  }

  getEvents(eventName) {
    return this.messages.filter((m) => m.event === eventName);
  }
}

async function runTestSuite() {
  log('================================================================================');
  log('MODULE 05 STEP 4: VERIFY — REAL-TIME ACTIVITY FEED FULL REGRESSION SUITE');
  log(`Timestamp: ${new Date().toISOString()}`);
  log('Target Component: ActivityFeedGateway & ActivityFeedService');
  log('Strategy: Option B (Restart-Early)');
  log('================================================================================\n');

  let testsPassed = 0;
  let totalTests = 0;

  function assert(condition, label, details) {
    totalTests++;
    if (condition) {
      testsPassed++;
      log(`[PASS] ${label}${details ? ` — ${details}` : ''}`);
    } else {
      log(`[FAIL] ${label}${details ? ` — ${details}` : ''}`);
    }
  }

  const authService = {
    verifyToken(token) {
      if (token === 'jwt_alice') return { sub: 'usr_alice', email: 'alice@alpha.io' };
      if (token === 'jwt_bob') return { sub: 'usr_bob', email: 'bob@alpha.io' };
      if (token === 'jwt_charlie') return { sub: 'usr_charlie', email: 'charlie@beta.io' };
      // Expired token explicitly returns null
      if (token === 'jwt_expired_token') return null;
      return null;
    },
  };

  const membershipStore = {
    isMember(teamId, userId) {
      const teamAlpha = ['usr_alice', 'usr_bob'];
      const teamBeta = ['usr_charlie'];
      if (teamId === 'team_alpha') return teamAlpha.includes(userId);
      if (teamId === 'team_beta') return teamBeta.includes(userId);
      return false;
    },
  };

  const feedService = new ActivityFeedService();
  const gateway = new ActivityFeedGateway(feedService, authService, membershipStore);

  // --- SECTION 1: Handshake Authentication & Negative Auth Cases ---
  log('--- SECTION 1: Handshake Authentication & Failure Modes ---');
  // 1.1 Valid JWT handshake
  const clientAlice = new MockSocketClient('sock_alice_1');
  const connAlice = gateway.handleConnection(clientAlice, 'Bearer jwt_alice');
  assert(connAlice.success === true && clientAlice.userId === 'usr_alice', 'Valid JWT establishes socket connection', `Principal: ${clientAlice.userId}`);
  assert(gateway.getActiveClientCount() === 1, 'Active client count incremented');

  // 1.2 Missing bearer header
  const clientNoAuth = new MockSocketClient('sock_no_auth');
  const resNoAuth = gateway.handleConnection(clientNoAuth, undefined);
  assert(resNoAuth.success === false && clientNoAuth.disconnectCode === 4001, 'Missing token rejects handshake with close code 4001');
  assert(clientNoAuth.getEvents('error')[0].data.error.code === 'UNAUTHORIZED', 'Missing token returns UNAUTHORIZED error envelope');

  // 1.3 Malformed authorization header (not starting with Bearer)
  const clientMalformed = new MockSocketClient('sock_malformed');
  const resMalformed = gateway.handleConnection(clientMalformed, 'Basic dXNlcjpwYXNz');
  assert(resMalformed.success === false && clientMalformed.disconnectCode === 4001, 'Malformed auth header rejected with close code 4001');

  // 1.4 Expired JWT token
  const clientExpired = new MockSocketClient('sock_expired');
  const resExpired = gateway.handleConnection(clientExpired, 'Bearer jwt_expired_token');
  assert(resExpired.success === false && clientExpired.disconnectCode === 4001, 'Expired JWT rejected with close code 4001');
  assert(clientExpired.getEvents('error')[0].data.error.message.includes('Invalid or expired'), 'Expired JWT returns informative error payload');

  // --- SECTION 2: Team-Scoped Channel Authorization & Tenant Isolation ---
  log('\n--- SECTION 2: Team-Scoped Channel Authorization & Tenant Isolation ---');
  // 2.1 Authorized join
  const joinAlpha = gateway.handleJoinTeam(clientAlice.id, 'team_alpha');
  assert(joinAlpha.success === true, 'Alice successfully authorized for team_alpha channel');

  // 2.2 Unauthorized join (Alice attempts to join team_beta)
  const joinBeta = gateway.handleJoinTeam(clientAlice.id, 'team_beta');
  assert(joinBeta.success === false && joinBeta.error === 'FORBIDDEN', 'Alice denied from team_beta with FORBIDDEN');
  assert(!clientAlice.subscribedTeams.has('team_beta'), 'Client not added to team_beta subscription set');
  assert(clientAlice.getEvents('error').some((e) => e.data.error.code === 'FORBIDDEN'), 'Client receives FORBIDDEN error event');

  // 2.3 Unauthenticated client join attempt
  const unauthJoin = gateway.handleJoinTeam('non_existent_client', 'team_alpha');
  assert(unauthJoin.success === false && unauthJoin.error === 'UNAUTHENTICATED_CLIENT', 'Unauthenticated client join rejected');

  // 2.4 Duplicate join attempt idempotency
  const dupJoin = gateway.handleJoinTeam(clientAlice.id, 'team_alpha');
  assert(dupJoin.success === true && dupJoin.alreadySubscribed === true, 'Duplicate join is idempotent and does not create duplicate subscriber');
  assert(feedService.getSubscriberCount('team_alpha') === 1, 'Team subscriber count remains exactly 1');

  // --- SECTION 3: Multi-Client Concurrency, Tenant Isolation & Event Ordering ---
  log('\n--- SECTION 3: Multi-Client Concurrency, Tenant Isolation & Monotonic Ordering ---');
  const clientBob = new MockSocketClient('sock_bob_1');
  gateway.handleConnection(clientBob, 'Bearer jwt_bob');
  gateway.handleJoinTeam(clientBob.id, 'team_alpha');

  const clientCharlie = new MockSocketClient('sock_charlie_1');
  gateway.handleConnection(clientCharlie, 'Bearer jwt_charlie');
  gateway.handleJoinTeam(clientCharlie.id, 'team_beta');

  // Publish 3 sequential events to Team Alpha
  feedService.publishEvent('team_alpha', 'LINK_CREATED', 'usr_alice', { code: 'lnk_1' });
  feedService.publishEvent('team_alpha', 'MEMBER_INVITED', 'usr_alice', { email: 'dev@alpha.io' });
  feedService.publishEvent('team_alpha', 'TEAM_UPDATED', 'usr_bob', { name: 'Alpha Core' });

  // Verification of delivery & tenant isolation
  const aliceEvents = clientAlice.getEvents('activity_event');
  const bobEvents = clientBob.getEvents('activity_event');
  const charlieEvents = clientCharlie.getEvents('activity_event');

  assert(aliceEvents.length === 3 && bobEvents.length === 3, 'Both Team Alpha concurrent subscribers received all 3 events');
  assert(charlieEvents.length === 0, 'Tenant Isolation: Team Beta subscriber received 0 events from Team Alpha');
  assert(
    bobEvents[0].data.sequenceNumber === 1 &&
      bobEvents[1].data.sequenceNumber === 2 &&
      bobEvents[2].data.sequenceNumber === 3,
    'Events delivered in strictly monotonic sequence (1 -> 2 -> 3)',
  );

  // --- SECTION 4: Disconnection Lifecycle & Heartbeat Zombie Sweep ---
  log('\n--- SECTION 4: Disconnection Lifecycle & Heartbeat Sweep ---');
  // 4.1 Heartbeat ping / pong
  const hbRes = gateway.handleHeartbeat(clientAlice.id);
  assert(hbRes === true && clientAlice.getEvents('pong').length === 1, 'Client heartbeat acknowledged with pong timestamp');

  // 4.2 Graceful disconnect
  gateway.handleDisconnect(clientBob.id, 1000);
  assert(gateway.getActiveClientCount() === 2, 'Active clients decremented upon graceful disconnect');
  assert(feedService.getSubscriberCount('team_alpha') === 1, 'Subscriber removed from feed service upon disconnect');

  // 4.3 Zombie connection sweep (idle client simulated)
  clientAlice.lastActiveAt = Date.now() - 40000;
  clientAlice.isAlive = false;
  const sweptCount = gateway.sweepInactiveClients(30000);
  assert(sweptCount === 1, 'Heartbeat monitor automatically swept 1 zombie client');
  assert(clientAlice.disconnectCode === 4008, 'Zombie socket terminated with timeout close code 4008');
  assert(gateway.getActiveClientCount() === 1, 'Gateway active client count reflects zombie sweep');

  // --- SECTION 5: Reconnection, Event Replay & Buffer Bounds ---
  log('\n--- SECTION 5: Reconnection, Event Replay & Ring Buffer Limits ---');
  // Publish event 4 while Bob is offline
  feedService.publishEvent('team_alpha', 'LINK_CREATED', 'usr_system', { code: 'lnk_4' });

  // Bob reconnects with new socket and requests replay since seq 1
  const bobReconnect = new MockSocketClient('sock_bob_2');
  gateway.handleConnection(bobReconnect, 'Bearer jwt_bob');
  const replayResult = gateway.handleReconnect(bobReconnect.id, 'team_alpha', 1);

  assert(replayResult.success === true && replayResult.replayedEventsCount === 3, 'Replay returned 3 missed events (seq 2, 3, 4)');
  assert(replayResult.historyTruncated === false, 'Replay indicates full history intact (historyTruncated: false)');
  const bobReplayedEvts = bobReconnect.getEvents('activity_event');
  assert(
    bobReplayedEvts[0].data.sequenceNumber === 2 &&
      bobReplayedEvts[1].data.sequenceNumber === 3 &&
      bobReplayedEvts[2].data.sequenceNumber === 4,
    'Replayed events delivered in strict chronological order',
  );

  // 5.2 Test Ring Buffer Capping (Publish 60 events, maxBufferSize = 50)
  for (let i = 5; i <= 65; i++) {
    feedService.publishEvent('team_alpha', 'LINK_CREATED', 'usr_system', { code: `lnk_${i}` });
  }
  assert(feedService.getBufferSize('team_alpha') === 50, 'Event ring buffer capped at maximum 50 events');

  // 5.3 Test Expired Replay History (client asks for seq 1, but buffer starts at seq 16)
  const bobOldReconnect = new MockSocketClient('sock_bob_3');
  gateway.handleConnection(bobOldReconnect, 'Bearer jwt_bob');
  const truncatedReplay = gateway.handleReconnect(bobOldReconnect.id, 'team_alpha', 1);
  assert(truncatedReplay.historyTruncated === true, 'Buffer overrun detected: historyTruncated is true when requested sequence is evicted');
  assert(truncatedReplay.replayedEventsCount === 50, 'Returned all remaining 50 buffered events');

  // --- SECTION 6: Data Sanitization & Recursive Deep Redaction ---
  log('\n--- SECTION 6: Data Sanitization & Deep Secret Redaction ---');
  const dirtyPayload = {
    title: 'New Integration',
    nestedConfig: {
      client_secret: 'super_secret_oauth_key',
      db_password_hash: '$2b$12$e80A1/example_hash',
      allowedOrigins: ['https://alpha.io'],
    },
    credentialsArray: [
      { apiKey: 'secret_api_key_1', name: 'Service Account' },
      { publicIdentifier: 'pub_svc_2' },
    ],
    safeMeta: { version: '2.0.0' },
  };

  const cleanEvent = feedService.publishEvent('team_beta', 'TEAM_UPDATED', 'usr_charlie', dirtyPayload);
  const p = cleanEvent.payload;

  assert(p.title === 'New Integration', 'Whitelisted top-level fields preserved');
  assert(p.nestedConfig.client_secret === undefined, 'Nested secret stripped');
  assert(p.nestedConfig.db_password_hash === undefined, 'Nested password hash stripped');
  assert(p.nestedConfig.allowedOrigins[0] === 'https://alpha.io', 'Nested array in safe object preserved');
  assert(p.credentialsArray[0].apiKey === undefined, 'Deeply nested API key in array object stripped');
  assert(p.credentialsArray[0].name === 'Service Account', 'Non-sensitive sibling in array object preserved');
  assert(p.credentialsArray[1].publicIdentifier === 'pub_svc_2', 'Safe array object intact');

  // --- SECTION 7: Malformed Event Rejection ---
  log('\n--- SECTION 7: Malformed Event Validation ---');
  let malformedCaught = false;
  try {
    feedService.publishEvent(null, 'LINK_CREATED', 'usr_alice', {});
  } catch (err) {
    malformedCaught = true;
  }
  assert(malformedCaught === true, 'Publishing event with missing teamId throws error');

  log('\n================================================================================');
  log(`SUMMARY: ${testsPassed} of ${totalTests} technical assertions PASSED`);
  log('================================================================================');

  if (testsPassed !== totalTests) {
    process.exitCode = 1;
  }
}

runTestSuite().catch(console.error);
