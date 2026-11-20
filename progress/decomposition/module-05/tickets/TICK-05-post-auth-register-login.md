# TICK-05: POST /api/v1/auth/register & login — Learner Auth (AI-READY SPEC)

## 1. Title
`TICK-05: POST /api/v1/auth/register & /api/v1/auth/login — Learner Authentication & JWT Issuance (AI-Ready)`

---

## 2. Context (Why)
Slice 2 introduces learner identity and personal booking history. To allow learners to track their upcoming sessions, reschedule, or cancel bookings, they must be able to securely register with an email and password and authenticate via a standard session cookie or Bearer JWT token.

---

## 3. Scope (What)
- Create database table `users` for storing learner accounts with hashed passwords.
- Implement `POST /api/v1/auth/register`:
  - Validate email format and password strength (minimum 8 characters, at least 1 number).
  - Check email uniqueness; return 409 Conflict if already registered.
  - Hash password using `bcrypt` (salt rounds: 12) or `argon2`.
  - Insert user record with default role `'LEARNER'`.
  - Issue secure HTTP-only session cookie containing signed JWT (or return access token in response body).
- Implement `POST /api/v1/auth/login`:
  - Verify email and password against stored hash.
  - Return 401 Unauthorized for invalid credentials.
  - Issue session cookie / JWT on success.
- Implement `GET /api/v1/auth/me`:
  - Protected endpoint returning authenticated learner profile from JWT.

---

## 4. Interface Contract (Inputs/Outputs/Data Shapes)

### Database Table Schema:
```sql
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(100) NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'LEARNER', -- 'LEARNER', 'PROVIDER', 'ADMIN'
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
```

### Route 1: Register
- **Endpoint:** `POST /api/v1/auth/register`
- **Request Body:**
```json
{
  "email": "learner.sarah@example.com",
  "password": "StrongPassword123!",
  "full_name": "Sarah Connor"
}
```
- **Response (201 Created):**
```json
{
  "user": {
    "id": "dddddddd-dddd-dddd-dddd-dddddddddddd",
    "email": "learner.sarah@example.com",
    "full_name": "Sarah Connor",
    "role": "LEARNER",
    "created_at": "2026-11-20T17:55:00.000Z"
  },
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

### Route 2: Login
- **Endpoint:** `POST /api/v1/auth/login`
- **Request Body:**
```json
{
  "email": "learner.sarah@example.com",
  "password": "StrongPassword123!"
}
```
- **Response (200 OK):**
```json
{
  "user": {
    "id": "dddddddd-dddd-dddd-dddd-dddddddddddd",
    "email": "learner.sarah@example.com",
    "full_name": "Sarah Connor",
    "role": "LEARNER"
  },
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

### Error Responses:
- **400 Bad Request:** Weak password or malformed email:
```json
{
  "error": {
    "code": "INVALID_PASSWORD",
    "message": "Password must be at least 8 characters long and contain at least one number."
  }
}
```
- **409 Conflict:** Email already registered:
```json
{
  "error": {
    "code": "EMAIL_ALREADY_EXISTS",
    "message": "An account with this email address is already registered."
  }
}
```
- **401 Unauthorized:** Invalid login credentials:
```json
{
  "error": {
    "code": "INVALID_CREDENTIALS",
    "message": "Invalid email or password."
  }
}
```

---

## 5. Acceptance Criteria (Given / When / Then)

### Scenario 1: New User Registration
- **Given** no user exists with email `sarah@example.com`,
- **When** a client sends `POST /api/v1/auth/register` with valid email, full name, and strong password,
- **Then** the server responds with HTTP status `201 Created`,
- **And** a new user record exists in `users` with hashed password,
- **And** the response returns a valid JWT token signed with `JWT_SECRET`.

### Scenario 2: Duplicate Email Registration
- **Given** a user already exists with email `sarah@example.com`,
- **When** another client attempts `POST /api/v1/auth/register` with the same email,
- **Then** the server responds with HTTP status `409 Conflict`,
- **And** the error code is `"EMAIL_ALREADY_EXISTS"`.

### Scenario 3: Successful Authentication
- **Given** an existing user with registered password `StrongPassword123!`,
- **When** the client sends `POST /api/v1/auth/login` with correct credentials,
- **Then** the server responds with HTTP status `200 OK` and a valid session token.

### Scenario 4: Authentication Failure (Wrong Password)
- **Given** an existing user,
- **When** the client sends `POST /api/v1/auth/login` with an incorrect password,
- **Then** the server responds with HTTP status `401 Unauthorized`,
- **And** the error code is `"INVALID_CREDENTIALS"`.

---

## 6. Constraints (Rules to Follow)
- Passwords must NEVER be logged or returned in any API response.
- Use `bcrypt.hash(password, 12)` for password hashing.
- JWT must include claims: `{ sub: user.id, email: user.email, role: user.role }` and have an expiration of 24 hours (`expiresIn: '24h'`).
- Follow project environment configuration for `JWT_SECRET`.

---

## 7. Anti-Scope (What NOT to Build)
- No OAuth providers (Google, GitHub, Apple).
- No email verification links or SMTP mailers.
- No "Forgot Password" or password reset tokens.
- No multi-factor authentication (MFA).
- No user profile picture uploads.
