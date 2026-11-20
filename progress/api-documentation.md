# Team Collaboration Platform — Production API Documentation

**Version**: 1.0.0  
**Security Standard**: Zero-Trust Authorization & Safe Error Envelopes  
**Authentication**: Bearer JWT (`Authorization: Bearer <token>`)  
**Base URL**: `https://api.internal.knack/v1`  

---

## 1. Authentication & Standard Envelopes

Every protected endpoint requires an `Authorization: Bearer <token>` header. Caller identity is cryptographically resolved to an authenticated principal (`req.user.id`). Unauthenticated requests are rejected with HTTP 401.

### Standard Success Envelope
```json
{
  "success": true,
  "data": { ... }
}
```

### Standard Error Envelope (`SafeErrorEnvelope`)
All error responses adhere to the unified exception schema:
```json
{
  "error": {
    "code": "FORBIDDEN | UNAUTHORIZED | BAD_REQUEST | NOT_FOUND | CONFLICT",
    "message": "Human-readable explanation of rejection"
  }
}
```

---

## 2. Endpoints Specification

### 2.1 POST `/teams` — Create Team
Creates a new tenant workspace. The authenticated creator is automatically assigned the `OWNER` role.

- **Method**: `POST`
- **Path**: `/teams`
- **Required Headers**: `Authorization: Bearer <token>`, `Content-Type: application/json`
- **Request Body**:
  ```json
  {
    "name": "Platform Engineering"
  }
  ```
  - `name`: String, non-empty, max 100 characters.
- **Success Response (`201 Created`)**:
  ```json
  {
    "id": "team_1795027812_a9f1",
    "name": "Platform Engineering",
    "ownerId": "usr_alice",
    "createdAt": "2026-11-19T00:15:00.000Z"
  }
  ```
- **Error Codes**: `400 BAD_REQUEST` (empty name), `401 UNAUTHORIZED` (missing auth).

---

### 2.2 POST `/teams/:id/invitations` — Send Team Invitation
Issues a secure invitation token to invite a collaborator with an assigned role.

- **Method**: `POST`
- **Path**: `/teams/:id/invitations`
- **Required Headers**: `Authorization: Bearer <token>`, `Content-Type: application/json`
- **Authorization Guard**: Caller must have `ADMIN` or `OWNER` role on team `:id`.
- **Request Body**:
  ```json
  {
    "email": "dev-lead@core.io",
    "role": "member"
  }
  ```
  - `email`: Valid email format string.
  - `role`: Enum whitelist: `"admin"` | `"member"` | `"viewer"`.
- **Success Response (`201 Created`)**:
  ```json
  {
    "id": "inv_1795027815",
    "token": "inv_tok_e9f8a7c6b5d4e3f2a1b0",
    "teamId": "team_1795027812_a9f1",
    "email": "dev-lead@core.io",
    "role": "MEMBER",
    "status": "PENDING",
    "expiresAt": "2026-11-26T00:15:00.000Z"
  }
  ```
- **Error Codes**:
  - `400 BAD_REQUEST`: Invalid email format or role.
  - `403 FORBIDDEN`: Requester is not an Admin or Owner.
  - `404 NOT_FOUND`: Team `:id` does not exist.
  - `409 CONFLICT`: An active invitation is already pending for this email.

---

### 2.3 POST `/invitations/:token/accept` — Accept Invitation
Consumes an invitation token and adds the authenticated user to the team.

- **Method**: `POST`
- **Path**: `/invitations/:token/accept`
- **Required Headers**: `Authorization: Bearer <token>`
- **Success Response (`200 OK`)**:
  ```json
  {
    "success": true,
    "membership": {
      "teamId": "team_1795027812_a9f1",
      "userId": "usr_bob",
      "role": "MEMBER",
      "joinedAt": "2026-11-19T00:16:00.000Z"
    }
  }
  ```
- **Error Codes**:
  - `400 BAD_REQUEST`: Token already accepted.
  - `400 EXPIRED_INVITATION`: Token past expiration timestamp.
  - `404 NOT_FOUND`: Token does not exist.

---

### 2.4 PUT `/teams/:id/members/:uid` — Update Member Role
Modifies a team member's role under strict hierarchical RBAC rules.

- **Method**: `PUT`
- **Path**: `/teams/:id/members/:uid`
- **Required Headers**: `Authorization: Bearer <token>`, `Content-Type: application/json`
- **Authorization Guard**: Caller must be `ADMIN` or `OWNER` on team `:id`.
- **Security Constraints**:
  - Caller cannot modify their own role (`uid !== caller.id`).
  - Admins cannot promote users to `owner`.
  - Non-owners cannot demote the team `owner`.
- **Request Body**:
  ```json
  {
    "role": "admin"
  }
  ```
  - `role`: Enum whitelist: `"admin"` | `"member"` | `"viewer"` (or `"owner"` if caller is owner).
- **Success Response (`200 OK`)**:
  ```json
  {
    "success": true,
    "member": {
      "teamId": "team_1795027812_a9f1",
      "userId": "usr_bob",
      "role": "ADMIN"
    },
    "audit": {
      "teamId": "team_1795027812_a9f1",
      "targetUserId": "usr_bob",
      "oldRole": "MEMBER",
      "newRole": "ADMIN",
      "requestingUserId": "usr_alice",
      "timestamp": "2026-11-19T00:17:00.000Z"
    }
  }
  ```
- **Error Codes**:
  - `400 BAD_REQUEST`: Role value is invalid, empty, or unwhitelisted.
  - `403 FORBIDDEN`: Insufficient permissions, self-modification attempt, or admin promoting to owner.
  - `404 NOT_FOUND`: Target user or team not found.

---

### 2.5 POST `/teams/:id/tasks/:taskId/comments` — Post Task Comment
Posts a threaded comment on a task with automated `@mention` parsing and EventBus dispatch.

- **Method**: `POST`
- **Path**: `/teams/:id/tasks/:taskId/comments`
- **Required Headers**: `Authorization: Bearer <token>`, `Content-Type: application/json`
- **Authorization Guard**: Caller must be a `MEMBER`, `ADMIN`, or `OWNER` of team `:id`. (Viewers forbidden).
- **Request Body**:
  ```json
  {
    "text": "Review complete. cc @usr_alice for final signoff."
  }
  ```
- **Success Response (`201 Created`)**:
  ```json
  {
    "id": "cmt_1795027820_x81",
    "teamId": "team_1795027812_a9f1",
    "taskId": "tsk_101",
    "authorId": "usr_bob",
    "text": "Review complete. cc @usr_alice for final signoff.",
    "mentions": ["usr_alice"],
    "createdAt": "2026-11-19T00:18:00.000Z"
  }
  ```
- **Error Codes**:
  - `403 FORBIDDEN`: Viewer attempting to comment, or cross-tenant user.
  - `404 NOT_FOUND`: Task not found in team.

---

### 2.6 GET `/teams/:id/feed` — Activity Feed
Returns monotonic, sequence-ordered activity events for the team.

- **Method**: `GET`
- **Path**: `/teams/:id/feed`
- **Authorization Guard**: Caller must be an authenticated member of team `:id`.
- **Success Response (`200 OK`)**:
  ```json
  [
    {
      "sequence": 1,
      "type": "team.created",
      "actorId": "usr_alice",
      "receivedAt": "2026-11-19T00:15:00.000Z"
    },
    {
      "sequence": 2,
      "type": "member.joined",
      "actorId": "usr_bob",
      "receivedAt": "2026-11-19T00:16:00.000Z"
    }
  ]
  ```

---

### 2.7 GET `/teams/:id/audit` — Audit Log
Returns structured audit trail records. Restricted strictly to `ADMIN` and `OWNER`.

- **Method**: `GET`
- **Path**: `/teams/:id/audit`
- **Query Parameters**: `action` (optional filter), `resourceType` (optional filter)
- **Authorization Guard**: `ADMIN` or `OWNER` only.
- **Success Response (`200 OK`)**:
  ```json
  [
    {
      "id": "aud_1795027812_k1",
      "action": "team.created",
      "resourceType": "team",
      "resourceId": "team_1795027812_a9f1",
      "actorId": "usr_alice",
      "timestamp": "2026-11-19T00:15:00.000Z"
    }
  ]
  ```
