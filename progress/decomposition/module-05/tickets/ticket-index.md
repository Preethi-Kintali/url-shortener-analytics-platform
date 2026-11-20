# SkillSwap — Task Specification Index (Module 05)

## Overview

This index tracks the decomposition of **Slice 1 (Browse & Book Seeded Walking Skeleton)** and **Slice 2 (Learner Authentication & Booking Lifecycle)** into six discrete, executable, prescriptive task tickets.

All tickets adhere to the **7-section standard**:
1. **Title:** Specific endpoint / technical task.
2. **Context:** Business rationale and placement in the user journey.
3. **Scope:** Granular execution boundary (under 2 hours execution time).
4. **Interface Contract:** Typed schemas, request/response JSON payloads, status codes, and database DDL.
5. **Acceptance Criteria:** Given/When/Then (BDD) behavioral test specifications.
6. **Constraints:** Architectural patterns, security rules, and performance guidelines.
7. **Anti-Scope:** Explicit list of adjacent features excluded from the ticket.

---

## Ticket Roster

| Ticket ID | Title | Slice | Target Layer | AI-Ready Bar? | Estimated Time |
|---|---|---|---|:---:|---|
| [**TICK-01**](./TICK-01-seed-providers-slots.md) | Seed Database with 3 Test Providers, Services & Slots | Slice 1 | Database / Migration | Yes | 1.5 hours |
| [**TICK-02**](./TICK-02-get-providers.md) | `GET /api/v1/providers` — List Seeded Providers with Services | Slice 1 | Backend API | Yes | 1.5 hours |
| [**TICK-03**](./TICK-03-get-provider-slots.md) | `GET /api/v1/providers/:id/slots` — Retrieve Available Slots | Slice 1 | Backend API | Yes | 1.0 hour |
| [**TICK-04**](./TICK-04-post-bookings-anonymous.md) | `POST /api/v1/bookings` — Create Anonymous Booking & Confirm Slot | Slice 1 | Database / API / Core Transaction | **YES (Primary)** | 2.0 hours |
| [**TICK-05**](./TICK-05-post-auth-register-login.md) | `POST /api/v1/auth/register` & `/login` — Learner Auth & JWT | Slice 2 | Auth / Security / API | **YES (Primary)** | 2.0 hours |
| [**TICK-06**](./TICK-06-get-learner-bookings-cancel.md) | `GET /api/v1/learners/me/bookings` & `POST /api/v1/bookings/:id/cancel` | Slice 2 | API / Lifecycle / Anti-IDOR | Yes | 2.0 hours |

---

## AI-Ready Ticket Highlights

- **TICK-04 (`POST /api/v1/bookings`):** Provides complete DDL schema, exact JSON request/response formats, atomic database transaction requirements, slot concurrency conflict codes (`409 Conflict`), and strict regex acceptance criteria for generated booking references (`^BK-[A-Z0-9]{6}$`). An autonomous AI agent can implement this without asking a single question.
- **TICK-05 (`POST /api/v1/auth/register & login`):** Completely specifies password hashing parameters (`bcrypt` with cost 12), token claims and TTL (`sub`, `email`, `role`, 24h), strict error code taxonomy (`EMAIL_ALREADY_EXISTS`, `INVALID_CREDENTIALS`), and anti-scope forbidding premature email verification or MFA.
