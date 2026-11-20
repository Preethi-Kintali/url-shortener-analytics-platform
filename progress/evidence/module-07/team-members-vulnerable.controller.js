// ============================================================================
// MODULE 07 EVIDENCE: VULNERABLE TEAM MEMBERS CONTROLLER (PRE-FIX BASELINE)
// ============================================================================
// Express/Nest-compatible handler exposing PUT /teams/:id/members/:uid
// with zero input validation or privilege verification.
// ============================================================================

const { VulnerableTeamMembersService } = require('./team-members-vulnerable.service');

class VulnerableTeamMembersController {
  constructor(vulnerableService = new VulnerableTeamMembersService()) {
    this.service = vulnerableService;
  }

  /**
   * Vulnerable Express-compatible handler for PUT /teams/:id/members/:uid
   */
  async updateMemberRoleHandler(req, res) {
    const teamId = req.params?.id;
    const targetUserId = req.params?.uid;
    // Uses untrusted header fallback without JWT verification
    const callerUserId = req.user?.id || req.headers?.['x-user-id'];
    const roleInput = req.body?.role;

    try {
      const result = this.service.updateMemberRole(
        teamId,
        callerUserId,
        targetUserId,
        roleInput
      );
      return res.status(200).json(result);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }
}

module.exports = { VulnerableTeamMembersController };
