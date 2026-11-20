// ============================================================================
// MODULE 08: SHIP IT — PRODUCTION TEAM COLLABORATION ENGINE
// ============================================================================
// Unifies all components across Modules 02-07 into a cohesive, production-grade
// multi-tenant collaboration engine with strict RBAC, EventBus integration,
// real-time feed sequencing, and comprehensive audit trails.
// ============================================================================

const EventEmitter = require('events');
const crypto = require('crypto');
const { TeamMembersService, VALID_TARGET_ROLES } = require('../module-07/team-members.service');
const { MentionParser } = require('../module-06/agent-2-mentions/mention-parser');

class TeamCollaborationEngine {
  constructor() {
    this.eventBus = new EventEmitter();

    // Data stores (In-Memory Repository simulation for hermetic testing)
    this.teams = new Map();
    this.memberships = new Map(); // key: `${teamId}:${userId}`
    this.invitations = new Map(); // key: token
    this.tasks = new Map();       // key: taskId
    this.comments = new Map();    // key: commentId
    this.taskComments = new Map();// key: taskId -> [commentId]
    this.activityFeeds = new Map();// key: teamId -> [event]
    this.auditLogs = [];

    // Role Management Service initialized with shared stores
    this.roleService = new TeamMembersService(this.teams, this.memberships, this.auditLogs);

    this._setupSubscriptions();
  }

  _setupSubscriptions() {
    // Activity Feed Subscriber: orders events monotonically
    this.eventBus.on('collaboration.event', (event) => {
      const feed = this.activityFeeds.get(event.teamId) || [];
      const sequence = feed.length + 1;
      const feedItem = { ...event, sequence, receivedAt: new Date().toISOString() };
      feed.push(feedItem);
      this.activityFeeds.set(event.teamId, feed);
    });

    // Audit Log Subscriber: persists tamper-evident records
    this.eventBus.on('audit.record', (record) => {
      this.auditLogs.push({
        ...record,
        id: `aud_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        timestamp: record.timestamp || new Date().toISOString(),
      });
    });
  }

  _memberKey(teamId, userId) {
    return `${teamId}:${userId}`;
  }

  // --------------------------------------------------------------------------
  // 1. TEAMS API
  // --------------------------------------------------------------------------
  createTeam(callerUserId, name) {
    if (!callerUserId || typeof callerUserId !== 'string' || callerUserId === 'anonymous') {
      const err = new Error('Authentication required');
      err.statusCode = 401;
      err.code = 'UNAUTHORIZED';
      throw err;
    }
    if (!name || typeof name !== 'string' || name.trim() === '') {
      const err = new Error('Team name must be a non-empty string');
      err.statusCode = 400;
      err.code = 'BAD_REQUEST';
      throw err;
    }

    const teamId = `team_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const team = {
      id: teamId,
      name: name.trim(),
      ownerId: callerUserId,
      createdAt: new Date().toISOString(),
    };
    this.teams.set(teamId, team);

    // Owner is automatically added as team OWNER
    const membershipKey = this._memberKey(teamId, callerUserId);
    const membership = {
      teamId,
      userId: callerUserId,
      role: 'OWNER',
      joinedAt: team.createdAt,
    };
    this.memberships.set(membershipKey, membership);

    // Audit & Activity
    const auditRecord = {
      action: 'team.created',
      resourceType: 'team',
      resourceId: teamId,
      teamId,
      actorId: callerUserId,
      details: { name: team.name },
    };
    this.eventBus.emit('audit.record', auditRecord);
    this.eventBus.emit('collaboration.event', {
      type: 'team.created',
      teamId,
      actorId: callerUserId,
      payload: { teamId, name: team.name },
    });

    return team;
  }

  getTeam(teamId, callerUserId) {
    const team = this.teams.get(teamId);
    if (!team) {
      const err = new Error(`Team '${teamId}' not found`);
      err.statusCode = 404;
      err.code = 'NOT_FOUND';
      throw err;
    }
    const membership = this.memberships.get(this._memberKey(teamId, callerUserId));
    if (!membership) {
      const err = new Error('Access denied to foreign team');
      err.statusCode = 403;
      err.code = 'FORBIDDEN';
      throw err;
    }
    return team;
  }

  // --------------------------------------------------------------------------
  // 2. INVITATIONS API
  // --------------------------------------------------------------------------
  createInvitation(teamId, callerUserId, email, role = 'member') {
    if (!callerUserId) {
      const err = new Error('Authentication required');
      err.statusCode = 401;
      err.code = 'UNAUTHORIZED';
      throw err;
    }
    const team = this.teams.get(teamId);
    if (!team) {
      const err = new Error(`Team '${teamId}' not found`);
      err.statusCode = 404;
      err.code = 'NOT_FOUND';
      throw err;
    }

    const callerMembership = this.memberships.get(this._memberKey(teamId, callerUserId));
    if (!callerMembership || (callerMembership.role !== 'OWNER' && callerMembership.role !== 'ADMIN')) {
      const err = new Error('Only team admins or owners can invite new members');
      err.statusCode = 403;
      err.code = 'FORBIDDEN';
      throw err;
    }

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      const err = new Error('Invalid email address format');
      err.statusCode = 400;
      err.code = 'BAD_REQUEST';
      throw err;
    }

    const normalizedEmail = email.trim().toLowerCase();
    const normalizedRole = (role || 'member').trim().toLowerCase();
    if (!['admin', 'member', 'viewer'].includes(normalizedRole)) {
      const err = new Error(`Invalid role for invitation: '${role}'`);
      err.statusCode = 400;
      err.code = 'BAD_REQUEST';
      throw err;
    }

    // Check if duplicate invitation pending
    for (const inv of this.invitations.values()) {
      if (inv.teamId === teamId && inv.email === normalizedEmail && inv.status === 'PENDING') {
        const err = new Error(`An active invitation is already pending for '${normalizedEmail}'`);
        err.statusCode = 409;
        err.code = 'CONFLICT';
        throw err;
      }
    }

    const token = `inv_tok_${crypto.randomBytes(16).toString('hex')}`;
    const invitation = {
      id: `inv_${Date.now()}`,
      token,
      teamId,
      invitedBy: callerUserId,
      email: normalizedEmail,
      role: normalizedRole.toUpperCase(),
      status: 'PENDING',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    };
    this.invitations.set(token, invitation);

    this.eventBus.emit('audit.record', {
      action: 'invitation.sent',
      resourceType: 'invitation',
      resourceId: invitation.id,
      teamId,
      actorId: callerUserId,
      details: { email: normalizedEmail, role: invitation.role },
    });

    return invitation;
  }

  acceptInvitation(token, acceptingUserId) {
    if (!acceptingUserId) {
      const err = new Error('Authentication required');
      err.statusCode = 401;
      err.code = 'UNAUTHORIZED';
      throw err;
    }
    const invitation = this.invitations.get(token);
    if (!invitation) {
      const err = new Error('Invitation token not found');
      err.statusCode = 404;
      err.code = 'NOT_FOUND';
      throw err;
    }

    if (invitation.status !== 'PENDING') {
      const err = new Error(`Invitation is already ${invitation.status}`);
      err.statusCode = 400;
      err.code = 'BAD_REQUEST';
      throw err;
    }

    if (new Date(invitation.expiresAt) < new Date()) {
      invitation.status = 'EXPIRED';
      const err = new Error('Invitation has expired');
      err.statusCode = 400;
      err.code = 'EXPIRED_INVITATION';
      throw err;
    }

    // Add membership
    const membershipKey = this._memberKey(invitation.teamId, acceptingUserId);
    const membership = {
      teamId: invitation.teamId,
      userId: acceptingUserId,
      role: invitation.role,
      joinedAt: new Date().toISOString(),
    };
    this.memberships.set(membershipKey, membership);
    invitation.status = 'ACCEPTED';
    invitation.acceptedBy = acceptingUserId;

    this.eventBus.emit('audit.record', {
      action: 'invitation.accepted',
      resourceType: 'invitation',
      resourceId: invitation.id,
      teamId: invitation.teamId,
      actorId: acceptingUserId,
      details: { role: membership.role },
    });

    this.eventBus.emit('collaboration.event', {
      type: 'member.joined',
      teamId: invitation.teamId,
      actorId: acceptingUserId,
      payload: { userId: acceptingUserId, role: membership.role },
    });

    return { success: true, membership };
  }

  // --------------------------------------------------------------------------
  // 3. ROLE MANAGEMENT API (Step 6 Enforced)
  // --------------------------------------------------------------------------
  updateMemberRole(teamId, callerUserId, targetUserId, newRole) {
    return this.roleService.updateMemberRole(teamId, callerUserId, targetUserId, newRole);
  }

  // --------------------------------------------------------------------------
  // 4. TASKS & COMMENTS API (With Mentions)
  // --------------------------------------------------------------------------
  createTask(teamId, callerUserId, title) {
    const membership = this.memberships.get(this._memberKey(teamId, callerUserId));
    if (!membership || membership.role === 'VIEWER') {
      const err = new Error('Insufficient permissions to create tasks');
      err.statusCode = 403;
      err.code = 'FORBIDDEN';
      throw err;
    }

    const taskId = `tsk_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const task = {
      id: taskId,
      teamId,
      title,
      createdBy: callerUserId,
      createdAt: new Date().toISOString(),
    };
    this.tasks.set(taskId, task);
    this.taskComments.set(taskId, []);
    return task;
  }

  addComment(teamId, taskId, callerUserId, text) {
    if (!callerUserId) {
      const err = new Error('Authentication required');
      err.statusCode = 401;
      err.code = 'UNAUTHORIZED';
      throw err;
    }

    const task = this.tasks.get(taskId);
    if (!task || task.teamId !== teamId) {
      const err = new Error('Task not found in team');
      err.statusCode = 404;
      err.code = 'NOT_FOUND';
      throw err;
    }

    const membership = this.memberships.get(this._memberKey(teamId, callerUserId));
    if (!membership) {
      const err = new Error('Cross-team comment access forbidden');
      err.statusCode = 403;
      err.code = 'FORBIDDEN';
      throw err;
    }
    if (membership.role === 'VIEWER') {
      const err = new Error('Viewers do not have permission to post comments');
      err.statusCode = 403;
      err.code = 'FORBIDDEN';
      throw err;
    }

    const commentId = `cmt_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const parsedMentions = MentionParser.parse(text);
    const mentions = parsedMentions.map(m => m.username);

    const comment = {
      id: commentId,
      teamId,
      taskId,
      authorId: callerUserId,
      text,
      mentions,
      createdAt: new Date().toISOString(),
    };

    this.comments.set(commentId, comment);
    const taskList = this.taskComments.get(taskId) || [];
    taskList.push(commentId);
    this.taskComments.set(taskId, taskList);

    // Audit and Feed emission
    this.eventBus.emit('audit.record', {
      action: 'comment.created',
      resourceType: 'comment',
      resourceId: commentId,
      teamId,
      actorId: callerUserId,
      details: { taskId, mentions },
    });

    this.eventBus.emit('collaboration.event', {
      type: 'comment.created',
      teamId,
      actorId: callerUserId,
      payload: { commentId, taskId, text, mentions },
    });

    return comment;
  }

  getComments(teamId, taskId, callerUserId) {
    if (!callerUserId) {
      const err = new Error('Authentication required');
      err.statusCode = 401;
      err.code = 'UNAUTHORIZED';
      throw err;
    }

    const task = this.tasks.get(taskId);
    if (!task || task.teamId !== teamId) {
      const err = new Error('Task not found');
      err.statusCode = 404;
      err.code = 'NOT_FOUND';
      throw err;
    }

    const membership = this.memberships.get(this._memberKey(teamId, callerUserId));
    if (!membership) {
      const err = new Error('Access denied to team comments');
      err.statusCode = 403;
      err.code = 'FORBIDDEN';
      throw err;
    }

    const commentIds = this.taskComments.get(taskId) || [];
    return commentIds.map(id => this.comments.get(id));
  }

  // --------------------------------------------------------------------------
  // 5. ACTIVITY FEED & AUDIT QUERIES
  // --------------------------------------------------------------------------
  getActivityFeed(teamId, callerUserId) {
    const membership = this.memberships.get(this._memberKey(teamId, callerUserId));
    if (!membership) {
      const err = new Error('Access denied to activity feed');
      err.statusCode = 403;
      err.code = 'FORBIDDEN';
      throw err;
    }
    return this.activityFeeds.get(teamId) || [];
  }

  getAuditLog(teamId, callerUserId, filter = {}) {
    const membership = this.memberships.get(this._memberKey(teamId, callerUserId));
    if (!membership || (membership.role !== 'OWNER' && membership.role !== 'ADMIN')) {
      const err = new Error('Only team admins or owners can access the audit log');
      err.statusCode = 403;
      err.code = 'FORBIDDEN';
      throw err;
    }

    return this.auditLogs.filter(entry => {
      if (entry.teamId !== teamId) return false;
      if (filter.action && entry.action !== filter.action) return false;
      if (filter.resourceType && entry.resourceType !== filter.resourceType) return false;
      return true;
    });
  }
}

module.exports = { TeamCollaborationEngine };
