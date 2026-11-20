// ============================================================================
// MODULE 07 EVIDENCE: VULNERABLE TEAM MEMBERS SERVICE (PRE-FIX BASELINE)
// ============================================================================
// This file represents the original vulnerable course baseline that allowed
// the privilege escalation demonstrated in Step 5: BREAK.
//
// VULNERABILITIES PRESENT:
// 1. SEC-01 (Broken Authorization): Checks `isTeamMember` instead of `isTeamAdmin`.
// 2. SEC-02 (Missing Validation): Accepts arbitrary string for role without enum check.
// 3. IDOR / Self-Targeting: Does not prevent caller from updating their own role.
// 4. Missing Audit Logging: Role mutations occur silently without audit trail.
// ============================================================================

class VulnerableTeamMembersService {
  constructor(teamStore = new Map(), membershipStore = new Map()) {
    this.teamStore = teamStore;
    this.membershipStore = membershipStore;
  }

  /**
   * Vulnerable implementation of role update.
   */
  updateMemberRole(teamId, callerUserId, targetUserId, role) {
    // Check 1: Does the team exist?
    const team = this.teamStore.get(teamId);
    if (!team) throw new Error('Team not found');

    // FLAW 1 (SEC-01): Only checks isTeamMember, NOT isTeamAdmin!
    // Any member, including a VIEWER, passes this check.
    const caller = this.membershipStore.get(`${teamId}:${callerUserId}`);
    if (!caller) throw new Error('Not a team member');

    // Check 2: Does target user exist in team?
    const target = this.membershipStore.get(`${teamId}:${targetUserId}`);
    if (!target) throw new Error('Target not found');

    // FLAW 2 (SEC-02): Zero validation on role value (allows 'admin', 'superadmin', etc.)
    // FLAW 3: No check preventing self-modification (callerUserId === targetUserId).
    target.role = role;

    return {
      success: true,
      member: {
        teamId: target.teamId,
        userId: target.userId,
        role: target.role,
      },
    };
  }
}

module.exports = { VulnerableTeamMembersService };
