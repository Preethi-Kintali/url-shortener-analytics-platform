// ============================================================================
// AGENT 1: COMMENT THREADS SERVICE (FIXED FOR STEP 6)
// ============================================================================

const { EventNames } = require('../interface-contracts');

class CommentsService {
  constructor(eventBus, taskStore, membershipStore) {
    this.eventBus = eventBus;
    this.taskStore = taskStore;
    this.membershipStore = membershipStore;
    this.comments = new Map(); // commentId -> Comment
  }

  createComment(taskId, authorId, body, parentId = null) {
    const task = this.taskStore.getTask(taskId);
    if (!task) {
      throw new Error(`NOT_FOUND: Task '${taskId}' does not exist`);
    }

    // Verify author is member of the team owning the task
    const isMember = this.membershipStore.isMember(task.teamId, authorId);
    if (!isMember) {
      throw new Error(`FORBIDDEN: User '${authorId}' is not authorized to comment on task '${taskId}'`);
    }

    if (!body || typeof body !== 'string' || body.trim().length === 0 || body.length > 5000) {
      throw new Error('BAD_REQUEST: Comment body must be between 1 and 5000 characters');
    }

    if (parentId && !this.comments.has(parentId)) {
      throw new Error(`BAD_REQUEST: Parent comment '${parentId}' does not exist`);
    }

    const commentId = `cmt_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const now = new Date().toISOString();

    const comment = {
      id: commentId,
      taskId,
      authorId,
      body: body.trim(),
      parentId: parentId || null,
      createdAt: now,
      updatedAt: now,
    };

    this.comments.set(commentId, comment);

    // Emit event matching interface contract
    if (this.eventBus) {
      this.eventBus.emit(EventNames.COMMENT_CREATED, {
        commentId: comment.id,
        taskId: comment.taskId,
        authorId: comment.authorId,
        body: comment.body,
        timestamp: comment.createdAt,
      });
    }

    return comment;
  }

  getComments(taskId, callerUserId) {
    // Mandatory authentication enforcement - no optional bypasses or arguments.length heuristics
    if (!callerUserId || typeof callerUserId !== 'string' || callerUserId.trim() === '' || callerUserId === 'anonymous') {
      throw new Error('UNAUTHORIZED: Authentication required to view comments');
    }

    const task = this.taskStore.getTask(taskId);
    if (!task) {
      throw new Error(`NOT_FOUND: Task '${taskId}' does not exist`);
    }

    // Tenant isolation verification: caller must belong to the team owning the requested task
    const isMember = this.membershipStore.isMember(task.teamId, callerUserId.trim());
    if (!isMember) {
      throw new Error(`FORBIDDEN: User '${callerUserId}' is not authorized to view comments on task '${taskId}'`);
    }

    return Array.from(this.comments.values()).filter((c) => c.taskId === taskId);
  }

  updateComment(commentId, authorId, newBody) {
    const comment = this.comments.get(commentId);
    if (!comment) {
      throw new Error(`NOT_FOUND: Comment '${commentId}' does not exist`);
    }

    if (comment.authorId !== authorId) {
      throw new Error(`FORBIDDEN: Only the author can update comment '${commentId}'`);
    }

    if (!newBody || typeof newBody !== 'string' || newBody.trim().length === 0 || newBody.length > 5000) {
      throw new Error('BAD_REQUEST: Updated body must be between 1 and 5000 characters');
    }

    comment.body = newBody.trim();
    comment.updatedAt = new Date().toISOString();

    if (this.eventBus) {
      this.eventBus.emit(EventNames.COMMENT_UPDATED, {
        commentId: comment.id,
        taskId: comment.taskId,
        authorId: comment.authorId,
        timestamp: comment.updatedAt,
      });
    }

    return comment;
  }

  deleteComment(commentId, authorId) {
    const comment = this.comments.get(commentId);
    if (!comment) {
      throw new Error(`NOT_FOUND: Comment '${commentId}' does not exist`);
    }

    if (comment.authorId !== authorId) {
      throw new Error(`FORBIDDEN: Only the author can delete comment '${commentId}'`);
    }

    this.comments.delete(commentId);

    if (this.eventBus) {
      this.eventBus.emit(EventNames.COMMENT_DELETED, {
        commentId,
        taskId: comment.taskId,
        authorId,
        timestamp: new Date().toISOString(),
      });
    }

    return { success: true };
  }
}

module.exports = { CommentsService };
