import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';

export enum TeamRole {
  OWNER = 'OWNER',
  ADMIN = 'ADMIN',
  MEMBER = 'MEMBER',
}

export interface TeamRecord {
  id: string;
  name: string;
  ownerId: string;
}

export interface TeamMemberRecord {
  teamId: string;
  userId: string;
  email: string;
  role: TeamRole;
}

export interface InvitationRecord {
  id: string;
  teamId: string;
  email: string;
  invitedBy: string;
  status: 'PENDING' | 'ACCEPTED' | 'REVOKED';
  createdAt: Date;
}

export interface IEmailService {
  sendInvitationEmail(to: string, teamName: string, inviteId: string): Promise<boolean>;
}

export interface IPrismaClient {
  team: {
    findUnique(args: { where: { id: string } }): Promise<TeamRecord | null>;
  };
  teamMember: {
    findUnique(args: {
      where: { teamId_userId: { teamId: string; userId: string } };
    }): Promise<TeamMemberRecord | null>;
    findFirst(args: {
      where: { teamId: string; email: string };
    }): Promise<TeamMemberRecord | null>;
  };
  invitation: {
    findFirst(args: {
      where: { teamId: string; email: string; status: 'PENDING' };
    }): Promise<InvitationRecord | null>;
    create(args: {
      data: {
        id: string;
        teamId: string;
        email: string;
        invitedBy: string;
        status: 'PENDING';
      };
    }): Promise<InvitationRecord>;
  };
}

const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

@Injectable()
export class InvitationsService {
  constructor(
    private readonly prisma: IPrismaClient,
    private readonly emailService: IEmailService,
  ) {}

  async createInvitation(teamId: string, principalId: string, rawEmail: string) {
    // 1. Authentication Guard Validation
    if (!principalId || typeof principalId !== 'string' || principalId.trim() === '') {
      throw new UnauthorizedException('Authenticated principal_id is required');
    }

    // 2. Input Validation (class-validator equivalent)
    if (!rawEmail || typeof rawEmail !== 'string' || !EMAIL_REGEX.test(rawEmail.trim())) {
      throw new BadRequestException('Invalid email address format');
    }
    const cleanEmail = rawEmail.trim().toLowerCase();

    // 3. Team Existence Verification
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
      (callerMembership.role !== TeamRole.OWNER && callerMembership.role !== TeamRole.ADMIN)
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
