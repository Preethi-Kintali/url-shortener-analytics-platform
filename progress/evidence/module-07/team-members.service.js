// ============================================================================
// MODULE 07 EVIDENCE: TEAM MEMBERS SERVICE (STEP 6 PRODUCTION-GRADE FIX)
// ============================================================================
// Remediates privilege escalation vulnerability in PUT /teams/:id/members/:uid
// Enforces 6 explicit constraints:
// 1. Only 'admin' or 'owner' role can modify member roles (403).
// 2. A user cannot modify their own role (403 'Cannot modify your own role').
// 3. Validate role field against enum ['admin', 'member', 'viewer'] (400 on invalid).
// 4. An admin cannot promote to owner; only owners can create owners (403).
// 5. Audit log entry recorded for all role changes.
// 6. Zero regressions; rigorous test coverage.
// ============================================================================

const VALID_TARGET_ROLES = ['admin', 'member', 'viewer', 'owner'];
const STANDARD_ROLES = ['admin', 'member', 'viewer'];

class TeamMembersService {
  constructor(teamStore = new Map(), membershipStore = new Map(), auditLog = []) {
    this.teamStore = teamStore;
    this.membershipStore = membershipStore;
    this.auditLog = auditLog;
  }

  // Helper: composite key for team_members
  _memberKey(teamId, userId) {
    return `${teamId}:${userId}`;
  }

  /**
   * Updates a team member's role enforcing all 6 security constraints.
   */
  updateMemberRole(teamId, callerUserId, targetUserId, roleInput) {
    // ------------------------------------------------------------------------
    // 1. Mandatory Authentication Check
    // ------------------------------------------------------------------------
    if (
      !callerUserId ||
      typeof callerUserId !== 'string' ||
      callerUserId.trim() === '' ||
      callerUserId === 'anonymous'
    ) {
      const err = new Error('Authentication required');
      err.statusCode = 401;
      err.code = 'UNAUTHORIZED';
      err.response = { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
      throw err;
    }

    const trimmedCallerId = callerUserId.trim();
    const trimmedTargetId = (targetUserId || '').trim();

    // ------------------------------------------------------------------------
    // 2. Input Validation (Constraint 3)
    // ------------------------------------------------------------------------
    if (typeof roleInput !== 'string' || roleInput.trim() === '') {
      const err = new Error('Role must be a non-empty string');
      err.statusCode = 400;
      err.code = 'BAD_REQUEST';
      err.response = { error: { code: 'BAD_REQUEST', message: 'Role must be a non-empty string' } };
      throw err;
    }

    const normalizedRole = roleInput.trim().toLowerCase();
    if (!VALID_TARGET_ROLES.includes(normalizedRole)) {
      const err = new Error(`Invalid role value: '${roleInput}'`);
      err.statusCode = 400;
      err.code = 'BAD_REQUEST';
      err.response = {
        error: {
          code: 'BAD_REQUEST',
          message: `Invalid role value: '${roleInput}'. Must be one of: ${STANDARD_ROLES.join(', ')}`,
        },
      };
      throw err;
    }

    // ------------------------------------------------------------------------
    // 3. Team Existence Verification
    // ------------------------------------------------------------------------
    const team = this.teamStore.get(teamId);
    if (!team) {
      const err = new Error(`Team '${teamId}' not found`);
      err.statusCode = 404;
      err.code = 'NOT_FOUND';
      err.response = { error: { code: 'NOT_FOUND', message: `Team '${teamId}' not found` } };
      throw err;
    }

    // ------------------------------------------------------------------------
    // 4. Authorization Verification (Constraint 1: isTeamAdminOrOwner)
    // ------------------------------------------------------------------------
    const callerKey = this._memberKey(teamId, trimmedCallerId);
    const callerMembership = this.membershipStore.get(callerKey);

    if (!callerMembership) {
      // Cross-tenant or non-member caller
      const err = new Error('Insufficient permissions to modify team member roles');
      err.statusCode = 403;
      err.code = 'FORBIDDEN';
      err.response = { error: { code: 'FORBIDDEN', message: 'Insufficient permissions to modify team member roles' } };
      throw err;
    }

    const callerRole = (callerMembership.role || '').toLowerCase();
    if (callerRole !== 'admin' && callerRole !== 'owner') {
      // Ordinary member or viewer attempting role modification
      const err = new Error('Insufficient permissions to modify team member roles');
      err.statusCode = 403;
      err.code = 'FORBIDDEN';
      err.response = { error: { code: 'FORBIDDEN', message: 'Insufficient permissions to modify team member roles' } };
      throw err;
    }

    // ------------------------------------------------------------------------
    // 5. Self-Modification Prohibition (Constraint 2)
    // ------------------------------------------------------------------------
    if (trimmedTargetId === trimmedCallerId) {
      const err = new Error('Cannot modify your own role');
      err.statusCode = 403;
      err.code = 'FORBIDDEN';
      err.response = { error: { code: 'FORBIDDEN', message: 'Cannot modify your own role' } };
      throw err;
    }

    // ------------------------------------------------------------------------
    // 6. Target Member Existence Check
    // ------------------------------------------------------------------------
    const targetKey = this._memberKey(teamId, trimmedTargetId);
    const targetMembership = this.membershipStore.get(targetKey);
    if (!targetMembership) {
      const err = new Error(`Member '${targetUserId}' not found in team '${teamId}'`);
      err.statusCode = 404;
      err.code = 'NOT_FOUND';
      err.response = { error: { code: 'NOT_FOUND', message: `Member '${targetUserId}' not found in team '${teamId}'` } };
      throw err;
    }

    // ------------------------------------------------------------------------
    // 7. Owner Promotion Restriction (Constraint 4)
    // ------------------------------------------------------------------------
    if (normalizedRole === 'owner' && callerRole !== 'owner') {
      const err = new Error('Only owners can promote another user to owner');
      err.statusCode = 403;
      err.code = 'FORBIDDEN';
      err.response = { error: { code: 'FORBIDDEN', message: 'Only owners can promote another user to owner' } };
      throw err;
    }

    // ------------------------------------------------------------------------
    // 8. Owner Protection (Admins cannot demote the team owner)
    // ------------------------------------------------------------------------
    if ((targetMembership.role || '').toLowerCase() === 'owner' && callerRole !== 'owner') {
      const err = new Error('Cannot modify role of team owner');
      err.statusCode = 403;
      err.code = 'FORBIDDEN';
      err.response = { error: { code: 'FORBIDDEN', message: 'Only team owner can modify owner permissions' } };
      throw err;
    }

    // ------------------------------------------------------------------------
    // 9. State Mutation
    // ------------------------------------------------------------------------
    const oldRole = targetMembership.role;
    const newRole = normalizedRole.toUpperCase();
    targetMembership.role = newRole;
    targetMembership.updatedAt = new Date().toISOString();
    this.membershipStore.set(targetKey, targetMembership);

    // ------------------------------------------------------------------------
    // 10. Audit Logging (Constraint 5)
    // ------------------------------------------------------------------------
    const auditEntry = {
      teamId,
      targetUserId: trimmedTargetId,
      oldRole,
      newRole,
      requestingUserId: trimmedCallerId,
      timestamp: targetMembership.updatedAt,
    };
    this.auditLog.push(auditEntry);

    return {
      success: true,
      member: {
        teamId,
        userId: trimmedTargetId,
        role: targetMembership.role,
      },
      audit: auditEntry,
    };
  }

  /**
   * Returns audit logs filtered by team.
   */
  getAuditLogs(teamId) {
    if (!teamId) return [...this.auditLog];
    return this.auditLog.filter(entry => entry.teamId === teamId);
  }
}

module.exports = {
  TeamMembersService,
  VALID_TARGET_ROLES,
  STANDARD_ROLES,
};
