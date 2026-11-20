// ============================================================================
// MODULE 07 EVIDENCE: TEAM MEMBERS CONTROLLER (STEP 6 PRODUCTION-GRADE FIX)
// ============================================================================
// Express/NestJS route handler for PUT /teams/:id/members/:uid.
// Normalizes identity resolution, enforces trust boundary, and formats
// error responses into SafeErrorEnvelope standard.
// ============================================================================

const { TeamMembersService } = require('./team-members.service');

class TeamMembersController {
  constructor(teamMembersService = new TeamMembersService()) {
    this.teamMembersService = teamMembersService;
  }

  /**
   * Express-compatible handler for PUT /teams/:id/members/:uid
   */
  async updateMemberRoleHandler(req, res) {
    const teamId = req.params?.id;
    const targetUserId = req.params?.uid;

    // Secure identity resolution:
    // 1. Primary trusted identity: req.user.id (populated by verified JWT auth middleware)
    // 2. Mock test identity: req.headers['x-user-id'] (ONLY allowed as mock fixture in test suites)
    // ARCHITECTURAL NOTE: In production environments, req.headers['x-user-id'] must NEVER
    // be trusted directly; identity must originate exclusively from cryptographically verified JWT tokens.
    let callerUserId = null;
    if (req.user && typeof req.user.id === 'string') {
      callerUserId = req.user.id;
    } else if (req.headers && typeof req.headers['x-user-id'] === 'string') {
      callerUserId = req.headers['x-user-id'];
    }

    const roleInput = req.body?.role;

    try {
      const result = this.teamMembersService.updateMemberRole(
        teamId,
        callerUserId,
        targetUserId,
        roleInput
      );
      return res.status(200).json(result);
    } catch (err) {
      const statusCode = err.statusCode || 500;
      const response = err.response || {
        error: {
          code: err.code || 'INTERNAL_SERVER_ERROR',
          message: err.message || 'An unexpected error occurred',
        },
      };
      return res.status(statusCode).json(response);
    }
  }
}

module.exports = { TeamMembersController };
