// ============================================================================
// AGENT 3: AUDIT LOG HTTP MIDDLEWARE (FIXED FOR STEP 6)
// ============================================================================

function createAuditMiddleware(auditService) {
  return function auditMiddleware(req, res, next) {
    const originalJson = res.json.bind(res);

    res.json = function (body) {
      if (['POST', 'PUT', 'DELETE'].includes(req.method)) {
        let action = 'update';
        if (req.method === 'POST') action = 'create';
        if (req.method === 'DELETE') action = 'delete';

        // Check path and originalUrl carefully:
        // More specific nested routes must be checked before parent route prefixes!
        const fullPath = req.originalUrl || req.path || '';
        let resourceType = 'unknown';
        let resourceId = req.params?.id || body?.id || 'unknown';

        if (fullPath.includes('/comments') || req.path?.includes('/comments')) {
          resourceType = 'comment';
          // For comment creation on /tasks/:taskId/comments, the comment ID is in body.id / body.commentId
          if (body?.id || body?.commentId) {
            resourceId = body.id || body.commentId;
          }
        } else if (fullPath.includes('/tasks') || req.path?.includes('/tasks')) {
          resourceType = 'task';
        } else if (fullPath.includes('/teams') || req.path?.includes('/teams')) {
          resourceType = 'team';
        }

        const actorId = req.user?.id || 'usr_anonymous';
        const taskId = req.params?.taskId || (fullPath.includes('/tasks/') ? fullPath.split('/tasks/')[1]?.split('/')[0] : undefined);

        try {
          auditService.record({
            action,
            resourceType,
            resourceId,
            actorId,
            metadata: {
              path: fullPath,
              statusCode: res.statusCode,
              taskId: resourceType === 'comment' ? taskId : undefined,
            },
          });
        } catch (err) {
          console.error('Audit logging error:', err.message);
        }
      }

      return originalJson(body);
    };

    if (next) next();
  };
}

module.exports = { createAuditMiddleware };
