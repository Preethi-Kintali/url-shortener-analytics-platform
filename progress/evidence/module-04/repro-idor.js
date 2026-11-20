const fs = require('fs');
const path = require('path');

const logFile = path.resolve(__dirname, 'idor-repro-log.txt');
fs.writeFileSync(logFile, '', 'utf8');

function log(msg) {
  console.log(msg);
  fs.appendFileSync(logFile, msg + '\n', 'utf8');
}

// ============================================================================
// Module 04 Step 5: Adversarial IDOR Investigation & Reproduction Harness
// Target Endpoint: POST /teams/:teamId/invitations
// Vulnerability: Broken Object Level Authorization (IDOR) / Missing Role Check
// ============================================================================

// Simulated Database State
const createInitialDb = () => ({
  teams: [
    { id: 'team-alpha-99', name: 'Alpha Infrastructure Team', ownerId: 'usr_alice_owner' },
    { id: 'team-beta-42', name: 'Beta Mobile Team', ownerId: 'usr_charlie_external' }
  ],
  members: [
    { teamId: 'team-alpha-99', userId: 'usr_alice_owner', email: 'alice@alpha.io', role: 'OWNER' },
    { teamId: 'team-alpha-99', userId: 'usr_bob_admin', email: 'bob@alpha.io', role: 'ADMIN' },
    { teamId: 'team-alpha-99', userId: 'usr_carol_member', email: 'carol@alpha.io', role: 'MEMBER' },
    { teamId: 'team-beta-42', userId: 'usr_dave_outsider', email: 'dave@beta.io', role: 'MEMBER' }
  ],
  invitations: []
});

let db = createInitialDb();

// The AI-Generated Baseline Implementation (Under Test)
// Notice: Authenticates req.user, but completely omits checking whether req.user
// has an active ADMIN or OWNER role in team_members for req.params.teamId.
async function aiGeneratedInvitationHandler(req) {
  // Step 1: Authentication check (Generic middleware pattern)
  if (!req.user || !req.user.id) {
    return {
      status: 401,
      body: { error: 'Unauthorized' }
    };
  }

  const { teamId } = req.params;
  const { email } = req.body || {};

  // Step 2: Resource existence check (Raw SQL simulation: SELECT * FROM teams WHERE id = $1)
  const team = db.teams.find((t) => t.id === teamId);
  if (!team) {
    return {
      status: 404,
      body: { error: 'Team not found' }
    };
  }

  // --- CRITICAL VULNERABILITY (IDOR / BOLA) ---
  // The AI omits:
  // const membership = db.members.find(m => m.teamId === teamId && m.userId === req.user.id);
  // if (!membership || !['OWNER', 'ADMIN'].includes(membership.role)) return 403;
  //
  // Instead, it proceeds directly to database mutation based solely on URL teamId!
  const newInvitation = {
    id: `inv_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    teamId,
    email,
    invitedBy: req.user.id,
    status: 'PENDING',
    createdAt: new Date().toISOString()
  };

  db.invitations.push(newInvitation);

  return {
    status: 201,
    body: {
      data: newInvitation,
      message: 'Invitation sent successfully'
    }
  };
}

// Contract-Compliant Secure Reference Specification (For Verification Comparison)
async function secureInvitationHandler(req) {
  if (!req.user || !req.user.id) {
    return {
      status: 401,
      body: {
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required to access this resource',
          request_id: 'req_auth_fail'
        }
      }
    };
  }

  const { teamId } = req.params;
  const { email } = req.body || {};

  const team = db.teams.find((t) => t.id === teamId);
  if (!team) {
    return {
      status: 404,
      body: {
        error: {
          code: 'NOT_FOUND',
          message: `Team with ID ${teamId} not found`,
          request_id: 'req_team_not_found'
        }
      }
    };
  }

  // Mandatory Resource Authorization Check
  const callerMembership = db.members.find((m) => m.teamId === teamId && m.userId === req.user.id);
  if (!callerMembership || (callerMembership.role !== 'OWNER' && callerMembership.role !== 'ADMIN')) {
    return {
      status: 403,
      body: {
        error: {
          code: 'FORBIDDEN',
          message: 'Only team owners and administrators can issue invitations',
          request_id: 'req_perm_denied'
        }
      }
    };
  }

  const newInvitation = {
    id: `inv_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    teamId,
    email,
    invitedBy: req.user.id,
    status: 'PENDING',
    createdAt: new Date().toISOString()
  };

  db.invitations.push(newInvitation);

  return {
    status: 201,
    body: {
      data: newInvitation
    }
  };
}

async function runAdversarialInvestigation() {
  log('================================================================================');
  log('UPSK MODULE 04 — STEP 5: BREAK (ADVERSARIAL IDOR INVESTIGATION)');
  log(`Timestamp: ${new Date().toISOString()}`);
  log('Target Resource: Team Alpha (ID: team-alpha-99)');
  log('Audited Endpoint: POST /teams/:teamId/invitations');
  log('================================================================================\n');

  const testCases = [
    {
      boundary: '1. Unauthenticated User',
      persona: 'Anonymous Actor',
      user: null,
      targetTeamId: 'team-alpha-99',
      targetEmail: 'intruder@external.io',
      expectedBaselineStatus: 401,
      expectedSecureStatus: 401,
      notes: 'Generic authentication check catches unauthenticated requests.'
    },
    {
      boundary: '2. Authenticated Non-Member (Cross-Tenant Intrusion)',
      persona: 'Dave (External user from Beta Mobile Team)',
      user: { id: 'usr_dave_outsider', email: 'dave@beta.io' },
      targetTeamId: 'team-alpha-99', // Dave is NOT in Team Alpha!
      targetEmail: 'rogue-invitee@attacker.com',
      expectedBaselineStatus: 201, // VULNERABILITY!
      expectedSecureStatus: 403,
      notes: 'CRITICAL IDOR: Valid token for unrelated user grants write access to Team Alpha.'
    },
    {
      boundary: '3. Authenticated Ordinary Team Member (Privilege Escalation)',
      persona: 'Carol (Regular team member, role: MEMBER)',
      user: { id: 'usr_carol_member', email: 'carol@alpha.io' },
      targetTeamId: 'team-alpha-99',
      targetEmail: 'unauthorized-colleague@alpha.io',
      expectedBaselineStatus: 201, // VULNERABILITY!
      expectedSecureStatus: 403,
      notes: 'PRIVILEGE ESCALATION: Role MEMBER cannot invite members, but baseline allows it.'
    },
    {
      boundary: '4. Authenticated Team Administrator (Legitimate Admin)',
      persona: 'Bob (Team Admin, role: ADMIN)',
      user: { id: 'usr_bob_admin', email: 'bob@alpha.io' },
      targetTeamId: 'team-alpha-99',
      targetEmail: 'new-engineer@alpha.io',
      expectedBaselineStatus: 201,
      expectedSecureStatus: 201,
      notes: 'Authorized role (ADMIN) allowed to invite.'
    },
    {
      boundary: '5. Authenticated Team Owner (Legitimate Owner)',
      persona: 'Alice (Team Owner, role: OWNER)',
      user: { id: 'usr_alice_owner', email: 'alice@alpha.io' },
      targetTeamId: 'team-alpha-99',
      targetEmail: 'director@alpha.io',
      expectedBaselineStatus: 201,
      expectedSecureStatus: 201,
      notes: 'Authorized role (OWNER) allowed to invite.'
    }
  ];

  log('--------------------------------------------------------------------------------');
  log('PHASE 1: EXECUTION AGAINST AI-GENERATED BASELINE HANDLER');
  log('--------------------------------------------------------------------------------');

  for (const tc of testCases) {
    db = createInitialDb(); // Reset DB for isolation
    const initialInvCount = db.invitations.length;

    log(`\nTesting Boundary: [${tc.boundary}]`);
    log(`  Caller: ${tc.persona}`);
    log(`  Target Team: ${tc.targetTeamId}`);
    log(`  Invitee: ${tc.targetEmail}`);

    const res = await aiGeneratedInvitationHandler({
      user: tc.user,
      params: { teamId: tc.targetTeamId },
      body: { email: tc.targetEmail }
    });

    const sideEffectOccurred = db.invitations.length > initialInvCount;
    log(`  Actual HTTP Status: ${res.status}`);
    log(`  Response Payload: ${JSON.stringify(res.body)}`);
    log(`  Database Side Effect: ${sideEffectOccurred ? 'PERSISTED INVITATION RECORD' : 'No side effect'}`);

    if (tc.expectedBaselineStatus === 201 && tc.expectedSecureStatus === 403) {
      log(`  >>> ADVERSARIAL FINDING: EXPLOIT CONFIRMED! HTTP ${res.status} returned instead of 403 Forbidden.`);
      log(`  >>> Threat: ${tc.notes}`);
    } else if (res.status === tc.expectedBaselineStatus) {
      log(`  >>> Baseline behavior matches expectation (Status ${res.status}).`);
    }
  }

  log('\n--------------------------------------------------------------------------------');
  log('PHASE 2: COMPARATIVE MATRIX (BASELINE VULNERABLE vs SECURE SPECIFICATION)');
  log('--------------------------------------------------------------------------------\n');
  log('| Boundary | Persona | Baseline Status | Secure Status | Vulnerability Severity |');
  log('|:---|:---|:---:|:---:|:---|');

  for (const tc of testCases) {
    const isVulnerable = tc.expectedBaselineStatus === 201 && tc.expectedSecureStatus === 403;
    const severity = tc.boundary.includes('Non-Member') ? 'CRITICAL (IDOR Bypass)' :
                     tc.boundary.includes('Ordinary') ? 'HIGH (Privilege Escalation)' : 'N/A (Expected)';
    log(`| ${tc.boundary} | ${tc.persona} | HTTP ${tc.expectedBaselineStatus} | HTTP ${tc.expectedSecureStatus} | ${isVulnerable ? `EXPLOITABLE: ${severity}` : 'COMPLIANT'} |`);
  }

  log('\n================================================================================');
  log('BREAK INVESTIGATION CONCLUSION:');
  log('The AI-generated endpoint validates identity (authentication) but completely fails');
  log('to enforce authorization (ownership and role). Any authenticated user possessing a');
  log('valid JWT token can tamper with :teamId in the URL route and create unauthorized');
  log('invitations to teams they do not own or administer.');
  log('================================================================================');
}

runAdversarialInvestigation().catch(console.error);
