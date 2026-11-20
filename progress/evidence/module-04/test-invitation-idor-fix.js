const fs = require('fs');
const path = require('path');
const {
  UnauthorizedException,
  ForbiddenException,
  NotFoundException,
  ConflictException,
  BadRequestException,
} = require(path.resolve(__dirname, '../../../api/node_modules/@nestjs/common'));

const logFile = path.resolve(__dirname, 'invitation-fix-test-output.txt');
fs.writeFileSync(logFile, '', 'utf8');

function log(msg) {
  console.log(msg);
  fs.appendFileSync(logFile, msg + '\n', 'utf8');
}

// ============================================================================
// REMEDIATED PRODUCTION-STANDARD SERVICE (STEP 6 FIX)
// ============================================================================

const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

class RemediatedInvitationsService {
  constructor(prisma, emailService) {
    this.prisma = prisma;
    this.emailService = emailService;
  }

  async createInvitation(teamId, principalId, rawEmail) {
    // 1. Authentication check
    if (!principalId || typeof principalId !== 'string' || principalId.trim() === '') {
      throw new UnauthorizedException('Authenticated principal_id is required');
    }

    // 2. Input validation
    if (!rawEmail || typeof rawEmail !== 'string' || !EMAIL_REGEX.test(rawEmail.trim())) {
      throw new BadRequestException('Invalid email address format');
    }
    const cleanEmail = rawEmail.trim().toLowerCase();

    // 3. Team existence verification
    const team = await this.prisma.team.findUnique({
      where: { id: teamId },
    });
    if (!team) {
      throw new NotFoundException(`Team with ID '${teamId}' not found`);
    }

    // 4. CRITICAL IDOR FIX: Verify Caller Authorization on the Target Team
    // Must query team_members for (teamId, principalId) composite key.
    // Only users with role OWNER or ADMIN have permission to issue invitations.
    const callerMembership = await this.prisma.teamMember.findUnique({
      where: {
        teamId_userId: {
          teamId,
          userId: principalId,
        },
      },
    });

    if (
      !callerMembership ||
      (callerMembership.role !== 'OWNER' && callerMembership.role !== 'ADMIN')
    ) {
      throw new ForbiddenException(
        'Forbidden: You do not have administrative permission to invite members to this team',
      );
    }

    // 5. Existing Team Member Conflict Check
    const existingMember = await this.prisma.teamMember.findFirst({
      where: {
        teamId,
        email: cleanEmail,
      },
    });
    if (existingMember) {
      throw new ConflictException(`User with email '${cleanEmail}' is already a member of this team`);
    }

    // 6. Duplicate Active Invitation Check
    const existingInvite = await this.prisma.invitation.findFirst({
      where: {
        teamId,
        email: cleanEmail,
        status: 'PENDING',
      },
    });
    if (existingInvite) {
      throw new ConflictException(`An active invitation is already pending for '${cleanEmail}'`);
    }

    // 7. Atomic Invitation Persistence
    const newInvitation = await this.prisma.invitation.create({
      data: {
        id: `inv_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
        teamId,
        email: cleanEmail,
        invitedBy: principalId,
        status: 'PENDING',
      },
    });

    // 8. External Email Notification
    await this.emailService.sendInvitationEmail(cleanEmail, team.name, newInvitation.id);

    return {
      id: newInvitation.id,
      team_id: newInvitation.teamId,
      email: newInvitation.email,
      status: newInvitation.status,
    };
  }
}

// Controller layer representation
class RemediatedInvitationsController {
  constructor(invitationsService) {
    this.invitationsService = invitationsService;
  }

  async createInvitation(teamId, principalId, dto) {
    return this.invitationsService.createInvitation(teamId, principalId, dto?.email);
  }
}

// Mock Database & Email Services
function createMockDb() {
  return {
    teams: [
      { id: 'team_alpha_01', name: 'Core Infrastructure Team', ownerId: 'usr_alice_owner' },
      { id: 'team_beta_02', name: 'Frontend Architecture Team', ownerId: 'usr_dave_outsider' },
    ],
    members: [
      { teamId: 'team_alpha_01', userId: 'usr_alice_owner', email: 'alice@core.io', role: 'OWNER' },
      { teamId: 'team_alpha_01', userId: 'usr_bob_admin', email: 'bob@core.io', role: 'ADMIN' },
      { teamId: 'team_alpha_01', userId: 'usr_carol_member', email: 'carol@core.io', role: 'MEMBER' },
      { teamId: 'team_beta_02', userId: 'usr_dave_outsider', email: 'dave@frontend.io', role: 'OWNER' },
    ],
    invitations: [],
    team: {
      async findUnique(args) {
        return createMockDb.instance.teams.find((t) => t.id === args.where.id) || null;
      },
    },
    teamMember: {
      async findUnique(args) {
        const { teamId, userId } = args.where.teamId_userId;
        return (
          createMockDb.instance.members.find((m) => m.teamId === teamId && m.userId === userId) ||
          null
        );
      },
      async findFirst(args) {
        const { teamId, email } = args.where;
        return (
          createMockDb.instance.members.find(
            (m) => m.teamId === teamId && m.email.toLowerCase() === email.toLowerCase(),
          ) || null
        );
      },
    },
    invitation: {
      async findFirst(args) {
        const { teamId, email, status } = args.where;
        return (
          createMockDb.instance.invitations.find(
            (inv) =>
              inv.teamId === teamId &&
              inv.email.toLowerCase() === email.toLowerCase() &&
              inv.status === status,
          ) || null
        );
      },
      async create(args) {
        const rec = { ...args.data, createdAt: new Date() };
        createMockDb.instance.invitations.push(rec);
        return rec;
      },
    },
  };
}

function createMockEmailService() {
  return {
    sentEmails: [],
    async sendInvitationEmail(to, teamName, inviteId) {
      this.sentEmails.push({ to, teamName, inviteId });
      return true;
    },
  };
}

async function runRegressionSuite() {
  log('================================================================================');
  log('UPSK MODULE 04 — STEP 6: FIX (IDOR REMEDIATION & REGRESSION TEST SUITE)');
  log(`Timestamp: ${new Date().toISOString()}`);
  log('Audited Service: RemediatedInvitationsService (NestJS Component)');
  log('Audited Controller: RemediatedInvitationsController (POST /teams/:teamId/invitations)');
  log('Target Resource: Team Alpha (team_alpha_01)');
  log('================================================================================\n');

  const db = createMockDb();
  createMockDb.instance = db;
  const emailService = createMockEmailService();
  const service = new RemediatedInvitationsService(db, emailService);
  const controller = new RemediatedInvitationsController(service);

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

  // --- BOUNDARY 1: Unauthenticated User ---
  log('--- TEST 1: Unauthenticated User (Missing Principal) ---');
  try {
    await controller.createInvitation('team_alpha_01', '', { email: 'stranger@external.io' });
    assert(false, 'Expected UnauthorizedException was not thrown');
  } catch (err) {
    assert(
      err instanceof UnauthorizedException && err.getStatus() === 401,
      'Unauthenticated request throws UnauthorizedException (HTTP 401)',
      `Status: ${err.getStatus()}, Message: "${err.message}"`,
    );
    assert(db.invitations.length === 0, 'Side effect check: 0 invitations created in database on 401');
    assert(emailService.sentEmails.length === 0, 'Side effect check: 0 emails dispatched on 401');
  }

  // --- BOUNDARY 2: Authenticated Non-Member (Cross-Tenant Access) ---
  log('\n--- TEST 2: Authenticated Non-Member (Cross-Tenant Intrusion Attempt) ---');
  try {
    // Dave is in team_beta_02, attempting to invite to team_alpha_01
    await controller.createInvitation('team_alpha_01', 'usr_dave_outsider', {
      email: 'collaborator@external.io',
    });
    assert(false, 'Expected ForbiddenException was not thrown for non-member');
  } catch (err) {
    assert(
      err instanceof ForbiddenException && err.getStatus() === 403,
      'Authenticated non-member is blocked with ForbiddenException (HTTP 403)',
      `Status: ${err.getStatus()}, Message: "${err.message}"`,
    );
    assert(db.invitations.length === 0, 'Side effect check: 0 invitations created in database on 403 (Non-member)');
    assert(emailService.sentEmails.length === 0, 'Side effect check: 0 emails dispatched on 403 (Non-member)');
  }

  // --- BOUNDARY 3: Authenticated Ordinary Team Member (Role: MEMBER) ---
  log('\n--- TEST 3: Authenticated Ordinary Team Member (Privilege Escalation Attempt) ---');
  try {
    // Carol is in team_alpha_01, but her role is MEMBER
    await controller.createInvitation('team_alpha_01', 'usr_carol_member', {
      email: 'new-colleague@core.io',
    });
    assert(false, 'Expected ForbiddenException was not thrown for ordinary member');
  } catch (err) {
    assert(
      err instanceof ForbiddenException && err.getStatus() === 403,
      'Ordinary member (role MEMBER) is blocked with ForbiddenException (HTTP 403)',
      `Status: ${err.getStatus()}, Message: "${err.message}"`,
    );
    assert(db.invitations.length === 0, 'Side effect check: 0 invitations created in database on 403 (Member)');
    assert(emailService.sentEmails.length === 0, 'Side effect check: 0 emails dispatched on 403 (Member)');
  }

  // --- BOUNDARY 4: Authenticated Team Administrator (Role: ADMIN) ---
  log('\n--- TEST 4: Authenticated Team Administrator (Legitimate Admin Access) ---');
  try {
    const adminResult = await controller.createInvitation('team_alpha_01', 'usr_bob_admin', {
      email: 'dev-lead@core.io',
    });
    assert(
      adminResult.status === 'PENDING' &&
        adminResult.email === 'dev-lead@core.io' &&
        adminResult.team_id === 'team_alpha_01',
      'Team Admin successfully issues invitation (HTTP 201 Created)',
      `id=${adminResult.id}, email=${adminResult.email}`,
    );
    assert(db.invitations.length === 1, 'Side effect check: 1 invitation persisted in database');
    assert(emailService.sentEmails.length === 1, 'Side effect check: 1 email dispatched to invitee');
    assert(
      emailService.sentEmails[0].to === 'dev-lead@core.io' &&
        emailService.sentEmails[0].teamName === 'Core Infrastructure Team',
      'Email payload verified: correct recipient and team context',
    );
  } catch (err) {
    assert(false, `Unexpected failure for team admin: ${err.message}`);
  }

  // --- BOUNDARY 5: Authenticated Team Owner (Role: OWNER) ---
  log('\n--- TEST 5: Authenticated Team Owner (Legitimate Owner Access) ---');
  try {
    const ownerResult = await controller.createInvitation('team_alpha_01', 'usr_alice_owner', {
      email: 'director-eng@core.io',
    });
    assert(
      ownerResult.status === 'PENDING' &&
        ownerResult.email === 'director-eng@core.io' &&
        ownerResult.team_id === 'team_alpha_01',
      'Team Owner successfully issues invitation (HTTP 201 Created)',
      `id=${ownerResult.id}, email=${ownerResult.email}`,
    );
    assert(db.invitations.length === 2, 'Side effect check: 2 total invitations in database');
    assert(emailService.sentEmails.length === 2, 'Side effect check: 2 total emails dispatched');
  } catch (err) {
    assert(false, `Unexpected failure for team owner: ${err.message}`);
  }

  // --- ADDITIONAL EDGE CASE REGRESSIONS ---
  log('\n--- TEST 6: Conflict on Existing Team Member ---');
  try {
    await controller.createInvitation('team_alpha_01', 'usr_alice_owner', {
      email: 'alice@core.io',
    });
    assert(false, 'Expected ConflictException was not thrown for existing member');
  } catch (err) {
    assert(
      err instanceof ConflictException && err.getStatus() === 409,
      'Inviting existing team member rejected with ConflictException (HTTP 409)',
      `Status: ${err.getStatus()}, Message: "${err.message}"`,
    );
    assert(db.invitations.length === 2, 'Side effect check: No new record created on 409 conflict');
    assert(emailService.sentEmails.length === 2, 'Side effect check: No email sent on 409 conflict');
  }

  log('\n--- TEST 7: Conflict on Duplicate Active Invitation ---');
  try {
    await controller.createInvitation('team_alpha_01', 'usr_bob_admin', {
      email: 'dev-lead@core.io', // Already invited in Test 4
    });
    assert(false, 'Expected ConflictException was not thrown for duplicate invitation');
  } catch (err) {
    assert(
      err instanceof ConflictException && err.getStatus() === 409,
      'Duplicate pending invitation rejected with ConflictException (HTTP 409)',
      `Status: ${err.getStatus()}, Message: "${err.message}"`,
    );
  }

  log('\n--- TEST 8: Malformed Email Input ---');
  try {
    await controller.createInvitation('team_alpha_01', 'usr_alice_owner', {
      email: 'invalid-email-address',
    });
    assert(false, 'Expected BadRequestException was not thrown for malformed email');
  } catch (err) {
    assert(
      err instanceof BadRequestException && err.getStatus() === 400,
      'Malformed email rejected with BadRequestException (HTTP 400)',
      `Status: ${err.getStatus()}, Message: "${err.message}"`,
    );
  }

  log('\n--- TEST 9: Non-Existent Team ID ---');
  try {
    await controller.createInvitation('non_existent_team_404', 'usr_alice_owner', {
      email: 'test@core.io',
    });
    assert(false, 'Expected NotFoundException was not thrown for missing team');
  } catch (err) {
    assert(
      err instanceof NotFoundException && err.getStatus() === 404,
      'Non-existent team rejected with NotFoundException (HTTP 404)',
      `Status: ${err.getStatus()}, Message: "${err.message}"`,
    );
  }

  log('\n================================================================================');
  log(`SUMMARY: ${testsPassed} of ${totalTests} assertions PASSED`);
  log('================================================================================');

  if (testsPassed !== totalTests) {
    process.exitCode = 1;
  }
}

runRegressionSuite().catch(console.error);
