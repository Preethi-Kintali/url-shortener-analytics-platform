# SkillSwap — Vertical Slicing Architecture (Module 04)

## Overview & Progression Strategy

This document establishes the vertical slice architecture for **SkillSwap**, a two-sided marketplace for on-demand skill-sharing sessions. 

Rather than building horizontal layers (all schemas → all APIs → all UI), SkillSwap is delivered through **five ordered, fully integrated vertical slices**. Each slice cuts across all five architectural layers (Database, Business Logic, External Stubs/Adapters, Backend API, and Frontend UI) to deliver a working, demonstrable walking skeleton that is testable by human stakeholders.

```
+-----------------------------------------------------------------------------------+
| SLICE 1: Browse & Book (Seeded Demand) [Walking Skeleton / MVP]                   |
| 3 Seeded Providers -> Single Service -> Fixed Slot -> Guest Booking Confirmation  |
+-----------------------------------------+-----------------------------------------+
                    |                                         |
                    | (Core Journey)                          | (Investor Demo Track)
                    v                                         v
+-----------------------------------------+       +---------------------------------+
| SLICE 2: Learner Auth & Booking Cycle   |       | SLICE 1.5: Payment Spike (Demo) |
| Sign In -> Authenticated Bookings       |       | Standalone Stripe Test Flow     |
+-----------------------------------------+       +---------------------------------+
                    |                                         |
                    +--------------------+--------------------+
                                         |
                                         v
+-----------------------------------------------------------------------------------+
| SLICE 3: Supply-Side Self-Service & Provider Schedule Management                  |
| Provider Profile Onboarding -> Service Catalog -> Weekly Recurring Calendar Grid |
+-----------------------------------------------------------------------------------+
                                         |
                                         v
+-----------------------------------------------------------------------------------+
| SLICE 4: Real-Time Slot Hold & Concurrency Control                                |
| 10-Min Atomic Slot Lock (Redis) -> Countdown Timer -> Double-Booking Prevention   |
+-----------------------------------------------------------------------------------+
                                         |
                                         v
+-----------------------------------------------------------------------------------+
| SLICE 5: Payment Processing, Commission Ledger & Booking Finalization             |
| PaymentContract / MockAdapter -> 20% Fee Split -> Automated Cancellation & Refund |
+-----------------------------------------------------------------------------------+
```

---

## Slice 1: Browse and Book (Seeded Demand Walking Skeleton)

### 1. Name
`Browse and Book (Seeded Data Walking Skeleton)`

### 2. Scope (What Is In)
- **Frontend UI:**
  - Marketplace home screen rendering 3 seeded provider cards displaying provider photo/avatar, full name, skill domain badge, star rating, and base hourly rate.
  - Provider profile detail screen showing provider bio, 1 featured service package (title, 60-minute duration, description), and a list of 3 fixed available time slots (e.g., 10:00 AM, 2:00 PM, 4:00 PM tomorrow).
  - Slot selection mechanism with active highlight state.
  - "Book Now" call-to-action button triggering booking creation.
  - Booking confirmation screen displaying generated Booking Reference ID (e.g., `#BK-1001`), Provider Name, Service Title, Scheduled Date/Time, and Status `CONFIRMED`.
- **Backend API:**
  - `GET /api/v1/providers`: Returns array of 3 seeded provider profiles with nested service offerings.
  - `GET /api/v1/providers/:id/slots`: Returns 3 available slots for the selected provider.
  - `POST /api/v1/bookings`: Accepts `{ provider_id, service_id, slot_time }`, creates an anonymous booking record, and returns HTTP 201 with booking payload.
- **Data Persistence:**
  - SQLite/PostgreSQL `bookings` table storing `id`, `provider_id`, `service_id`, `slot_time`, `status` (`CONFIRMED`), and `created_at`.
  - Database seed script initializing 3 realistic provider profiles and services.
- **Architectural Integration:**
  - Proves the full end-to-end request/response cycle from browser DOM down to persistent disk storage and back to confirmation screen.

### 3. Anti-Scope (What Is Explicitly Out)
- **No User Authentication:** No registration, login, passwords, session tokens, or JWTs. All actions are performed as anonymous guest users.
- **No Payment Processing:** No credit card inputs, Stripe integrations, or billing addresses. Bookings are zero-dollar mock transactions.
- **No Notifications:** No transactional emails (SendGrid), SMS (Twilio), or push notifications. Confirmation is rendered strictly on-screen.
- **No Search or Filtering:** No search input bar, category filter pills, price sliders, or pagination. Providers are statically rendered from the seed list.
- **No Provider Portal / Self-Service:** No provider registration, profile editing, or calendar management UI. Provider data exists solely via seed migrations.
- **No Dynamic Calendar Engine:** No recurring rule calculation, timezone translations, or calendar imports. Slots are fixed seed data records.
- **No Concurrency Control:** No distributed locks or race condition prevention if two browsers click the same slot simultaneously.
- **No Booking Modification or Cancellation:** No cancel button, reschedule modal, or cancellation policies.
- **No Reviews or Ratings:** No review submission form, star rating input, or feedback collection.
- **No Multi-Tenancy or Admin Dashboard:** No tenant isolation headers, platform admin views, or moderation queues.

### 4. Dependencies
- **None.** This is the foundational walking skeleton (Slice 1).

### 5. Acceptance Criteria
1. Open the application homepage: verify exactly 3 provider cards are visible with names ("Elena Rostova", "Marcus Vance", "Aisha Patel"), category tags, and hourly rates.
2. Click on the card for "Marcus Vance": navigate to Marcus's profile page and observe his service "1-on-1 System Architecture Coaching" along with 3 available time slots for tomorrow.
3. Click the "2:00 PM - 3:00 PM" time slot: slot card highlights as selected.
4. Click the "Book Now" button: system submits the request and redirects to `/booking/confirmation`.
5. Verify the confirmation screen displays Booking Reference `#BK-1001`, Provider Name "Marcus Vance", Service "1-on-1 System Architecture Coaching", Time "Tomorrow, 2:00 PM", and Status "CONFIRMED".
6. Refresh the browser page on the confirmation screen: verify the booking details reload successfully from the database (persisted, not transient state).

### 6. Estimated Complexity
- **S (Small — 2 to 3 hours)**

---

## Slice 1.5: Standalone Payment Rails Spike (Investor Demo Track)

### 1. Name
`Standalone Payment Rails Spike (Stripe Test Mode)`

### 2. Scope (What Is In)
- **Frontend UI:**
  - Standalone demonstration route at `/demo/payment-spike` clearly marked with a banner: *"Investor Demo Environment — Stripe Test Mode"*.
  - Checkout form featuring preset demo amounts ($25, $50, $100) and Stripe Elements card input fields supporting test cards (`4242...`).
  - Interactive test triggers for instant simulation of: (a) Successful Payment, (b) Declined Card, (c) Network Timeout retry.
  - Payment receipt card showing Stripe Charge ID, Amount, Currency, Status `SUCCEEDED`, and simulated platform commission breakdown (80% provider / 20% platform).
- **Backend API & Webhooks:**
  - `POST /api/v1/demo/payments/charge`: Creates a Stripe PaymentIntent and authorizes/captures using Stripe test secret keys.
  - `POST /api/v1/webhooks/stripe`: Validates cryptographic HMAC signatures using the webhook signing secret (`Stripe-Signature`), decodes `payment_intent.succeeded` events, and records the transaction.
  - Idempotency layer: Stores processed `event_id` keys in an in-memory/database set to ensure duplicate webhook deliveries are rejected without double-processing.
- **Data Persistence:**
  - Isolated `demo_payment_transactions` table capturing `{ id, stripe_payment_id, amount, currency, status, idempotency_key, created_at }`.

### 3. Anti-Scope (What Is Explicitly Out)
- **No Integration with Core Booking Journey:** Does not touch the Slice 1 booking flow; learners booking sessions in Slice 1 remain zero-friction.
- **No Production Banking / Live Credentials:** Strictly uses test API keys (`pk_test_...`, `sk_test_...`). No real money changes hands.
- **No Provider Bank Account Payouts:** No Stripe Connect Express or automated ACH/wire transfers.
- **No User Authentication:** Accessible directly via the `/demo/payment-spike` route without credentials.
- **No Dispute or Chargeback Workflow:** No manual arbitration or evidence submission UI.

### 4. Dependencies
- Can be built in parallel with or immediately following Slice 1. Does not block Slice 2.

### 5. Acceptance Criteria
1. Open Chrome and navigate to `http://localhost:3000/demo/payment-spike`: see the payment test harness with preselected amount $50.00.
2. Enter standard Stripe test card `4242 4242 4242 4242`, any future expiry, and any 3-digit CVC, then click "Authorize Test Payment".
3. Verify the UI displays an instant green confirmation: *"Charge Succeeded! Stripe ID: ch_test_3N... Amount: $50.00"*.
4. Enter test card `4000 0000 0000 0002` (Stripe decline test card): observe graceful inline error handling: *"Card was declined by issuing bank"*.
5. Trigger simulated webhook payload: server returns HTTP 200 with signature verified; replaying the same payload returns HTTP 200 with duplicate flag ignored.

### 6. Estimated Complexity
- **S (Small — 6 to 8 hours)**

---

## Slice 2: Learner Authentication & Booking Lifecycle

### 1. Name
`Learner Authentication & Booking Lifecycle`

### 2. Scope (What Is In)
- **Frontend UI:**
  - Learner Sign Up and Sign In modal/page (Email and Password fields with validation).
  - Header user status bar displaying logged-in learner's avatar/email and a "Sign Out" option.
  - "My Bookings" dashboard tab displaying all bookings created by the authenticated learner categorized into "Upcoming" and "Past" sessions.
  - Booking detail card with a "Cancel Booking" action button and confirmation prompt.
- **Backend API:**
  - `POST /api/v1/auth/register`: Validates email uniqueness, hashes password with bcrypt, creates user record, and issues secure HTTP-only JWT cookie.
  - `POST /api/v1/auth/login`: Authenticates credentials and returns session cookie.
  - `POST /api/v1/auth/logout`: Clears session cookie.
  - `GET /api/v1/learners/me/bookings`: Returns all bookings belonging to the authenticated learner.
  - `POST /api/v1/bookings`: Modified to enforce authenticated learner identity (`learner_id` foreign key).
  - `POST /api/v1/bookings/:id/cancel`: Updates booking status from `CONFIRMED` to `CANCELLED`.
- **Data Persistence:**
  - `users` table (`id`, `email`, `password_hash`, `role`, `created_at`).
  - Schema migration adding `learner_id` foreign key constraint to `bookings` table.

### 3. Anti-Scope (What Is Explicitly Out)
- **No Social OAuth:** No Google, GitHub, or Apple single sign-on.
- **No Email Verification / Password Reset:** No outbound email tokens or "Forgot Password" self-service flows.
- **No Provider Registration:** Providers remain seeded in the database; provider sign-up is deferred to Slice 3.
- **No Payment Refunds:** Cancellations update booking status only; no monetary calculations or ledger updates.
- **No Calendar Integration:** No Google Calendar sync or `.ics` file downloads.
- **No Role-Based Authorization Guards beyond Learner:** No administrative override permissions.

### 4. Dependencies
- **Slice 1 (Browse and Book Walking Skeleton)**

### 5. Acceptance Criteria
1. Navigate to the marketplace as a guest, pick a provider slot, and click "Book Now": the app intercepts and displays the "Sign In or Create Account" modal.
2. Enter email `learner@example.com` and password `Password123!` in the registration form: account is created and header updates to "Welcome, learner@example.com".
3. Return to slot selection and complete booking: confirmation displays Booking ID `#BK-1002` associated with the learner account.
4. Navigate to "My Bookings": verify `#BK-1002` appears under "Upcoming Sessions" with status `CONFIRMED`.
5. Click "Cancel Booking" and confirm the prompt: verify status badge updates to `CANCELLED` and booking is removed from active sessions.

### 6. Estimated Complexity
- **M (Medium — 1 day)**

---

## Slice 3: Supply-Side Self-Service & Provider Schedule Management

### 1. Name
`Supply-Side Self-Service & Provider Schedule Management`

### 2. Scope (What Is In)
- **Frontend UI:**
  - "Become a Provider" navigation link leading to Provider Onboarding flow.
  - 3-step provider profile wizard: (1) Bio, headline, and expertise category; (2) Service package creation (title, description, duration 30m/60m, price); (3) Weekly recurring availability calendar grid (selecting active days Mon–Sun and working hours 9:00 AM – 5:00 PM).
  - Provider Management Dashboard: View published services, view weekly schedule, and view "Received Bookings" queue.
- **Backend API:**
  - `POST /api/v1/providers/profile`: Creates provider record linked to authenticated user.
  - `POST /api/v1/providers/services`: Creates/updates service offerings.
  - `PUT /api/v1/providers/schedule`: Stores weekly availability rules.
  - `GET /api/v1/providers/:id/slots`: Upgraded from static seed to dynamic slot generation engine that computes real bookable slots for the next 14 days based on provider working hours minus existing bookings.
  - `GET /api/v1/providers/me/bookings`: Returns bookings submitted by learners for this provider.
- **Data Persistence:**
  - `providers` table (`id`, `user_id`, `bio`, `headline`, `category`, `hourly_rate`, `status`).
  - `services` table (`id`, `provider_id`, `title`, `description`, `duration_minutes`, `price_cents`).
  - `provider_schedules` table (`id`, `provider_id`, `day_of_week`, `start_time`, `end_time`).

### 3. Anti-Scope (What Is Explicitly Out)
- **No Background Check Integration:** No Checkr, IDology, or manual identity document upload workflows.
- **No Admin Vetting Gate:** Providers are automatically activated upon submission to allow immediate demand-supply testing.
- **No Bank Payout Onboarding:** No Stripe Connect Express onboarding or bank routing details.
- **No Irregular Blackout Dates / Holidays:** No custom vacation ranges or one-off date exclusions (recurring weekly schedule only).
- **No Instant Messaging / Chat:** No communication channel between learner and provider prior to booking.

### 4. Dependencies
- **Slice 2 (Learner Authentication & Booking Lifecycle)**

### 5. Acceptance Criteria
1. Sign in as a new user `expert@example.com` and click "Become a Provider".
2. Fill in bio "Staff Infrastructure Engineer", select category "DevOps", set rate "$75/hr", and add service "Kubernetes Production Readiness Audit (60 min)".
3. In the schedule builder, select Tuesdays and Thursdays from 10:00 AM to 2:00 PM, and click "Publish Profile".
4. Log out or open a separate incognito window as a learner: search or browse the home screen and verify "expert@example.com" appears as a live provider card.
5. Click on the profile: verify the available time slots dynamically match Tuesdays and Thursdays between 10:00 AM and 2:00 PM for the upcoming 14 days.
6. Book a Tuesday 11:00 AM slot as a learner; log back in as `expert@example.com` and verify the booking appears in the "Received Bookings" dashboard.

### 6. Estimated Complexity
- **M (Medium — 1.5 days)**

---

## Slice 4: Real-Time Slot Hold & Concurrency Control

### 1. Name
`Real-Time Slot Hold & Concurrency Control`

### 2. Scope (What Is In)
- **Frontend UI:**
  - Real-time slot status indicator with three distinct visual states: `AVAILABLE` (green/selectable), `HELD` (amber/locked with lock icon), and `BOOKED` (greyed out/disabled).
  - Slot hold reservation countdown timer displayed immediately upon selection: "Slot reserved for your checkout: 09:59 minutes remaining".
  - Invalidation modal: If user's hold expires or another user claims the slot first, modal notifies: "This slot is no longer available. Please select another time."
- **Backend API & Concurrency Logic:**
  - `POST /api/v1/slots/hold`: Issues an atomic reservation lock on `{ provider_id, slot_timestamp }` with a 10-minute Time-To-Live (TTL).
  - Redis distributed locking (`SET lock:slot:{provider_id}:{timestamp} {learner_id} NX EX 600`) ensuring strict mutual exclusion under concurrent requests.
  - `POST /api/v1/slots/release`: Allows user to voluntarily release a held slot prior to timer expiry.
  - `POST /api/v1/bookings`: Validates that the active hold token belongs to the requesting learner before converting the hold into a permanent booking.
  - Background expiration cleanup: When Redis TTL expires without booking completion, the slot automatically reverts to `AVAILABLE`.

### 3. Anti-Scope (What Is Explicitly Out)
- **No Live Payment Gateway:** Concurrency is de-risked and validated independently of external payment processor latency.
- **No WebSocket Infrastructure:** Slot status polling via lightweight REST heartbeat or Server-Sent Events (SSE) instead of complex bi-directional WebSockets.
- **No Multi-Region Redis Replication:** Single-instance or managed Redis cluster with standard sentinel; no multi-region conflict-free replicated data types.
- **No Overbooking Waitlists:** No queuing mechanism for learners wanting a notification if a held slot is released.

### 4. Dependencies
- **Slice 3 (Supply-Side Self-Service & Provider Schedule Management)**

### 5. Acceptance Criteria
1. Open Browser A (Learner Alice) and Browser B (Learner Bob) to Provider Marcus's profile page simultaneously.
2. Learner Alice clicks on Thursday 10:00 AM: Alice's screen initiates a 10-minute hold countdown timer.
3. In Browser B, Bob refreshes or views the slot: Thursday 10:00 AM displays as `HELD` with an amber badge and is unclickable.
4. Bob attempts to submit a direct API request to hold Thursday 10:00 AM: server returns HTTP 409 Conflict with `{ "error": "SLOT_CURRENTLY_HELD" }`.
5. Alice lets the 10-minute countdown expire (or clicks "Cancel Hold"): slot lock releases. Bob refreshes Browser B: slot transitions back to `AVAILABLE`.
6. Alice re-selects the slot and clicks "Complete Booking" within the 10-minute window: slot transitions permanently to `BOOKED` and cannot be held by anyone else.

### 6. Estimated Complexity
- **M (Medium — 1.5 days)**

---

## Slice 5: Payment Processing, Commission Ledger & Booking Finalization

### 1. Name
`Payment Processing, Commission Ledger & Booking Finalization`

### 2. Scope (What Is In)
- **Frontend UI:**
  - Checkout summary screen showing transparent price breakdown: Provider Fee ($50.00) + SkillSwap Platform Fee 20% ($10.00) = Total Due ($60.00).
  - Payment collection step integrated with `PaymentProviderContract` test card inputs (`4242...`).
  - Booking confirmation with downloadable receipt and cancellation policy notice ("Full refund available up to 24 hours prior to session start").
  - "Request Cancellation & Refund" workflow in learner dashboard displaying calculated refund eligibility based on session start timestamp.
- **Backend API & Business Logic:**
  - `PaymentProviderContract` interface with concrete `MockPaymentAdapter` (simulating authorization, capture, decline, and refund events without external merchant blocker).
  - `POST /api/v1/bookings/:id/checkout`: Atomically captures payment, converts slot hold to `PAID_CONFIRMED`, and creates commission ledger entry.
  - `POST /api/v1/bookings/:id/refund`: Evaluates cancellation cooling-off rules (REQ-10: >24h = 100% refund, <24h = non-refundable); triggers adapter refund and posts reversing ledger entry.
- **Data Persistence:**
  - `payments` table (`id`, `booking_id`, `amount_cents`, `currency`, `provider_transaction_id`, `status`).
  - `ledger_entries` table (`id`, `booking_id`, `gross_amount`, `platform_fee_amount`, `provider_net_amount`, `type`, `created_at`).

### 3. Anti-Scope (What Is Explicitly Out)
- **No Live Stripe Production Merchant Account:** Real banking credentials remain decoupled behind `PaymentProviderContract` until corporate entity registration completes.
- **No Direct Bank Payouts:** Provider earnings accumulate in the internal ledger; automated bank wire/ACH transfers are deferred.
- **No Multi-Currency FX / Sales Tax / VAT Engine:** All transactions are denominated in standard USD without automated jurisdictional tax calculation.
- **No Dispute / Chargeback Arbitration Workflow:** No payment dispute management dashboard.

### 4. Dependencies
- **Slice 4 (Real-Time Slot Hold & Concurrency Control)**

### 5. Acceptance Criteria
1. Learner holds an available $50.00 coaching session and proceeds to checkout: screen displays line items: Session Fee $50.00, Platform Fee (20%) $10.00, Total $60.00.
2. Learner enters test card details and clicks "Pay $60.00": system processes payment via `MockPaymentAdapter`, marks booking `PAID_CONFIRMED`, and displays success receipt.
3. Database inspection confirms a record in `ledger_entries` with `gross_amount: 6000`, `platform_fee_amount: 1000`, and `provider_net_amount: 5000`.
4. Learner navigates to "My Bookings" 48 hours prior to the session and clicks "Cancel & Refund": system validates >24h window, issues full $60.00 refund via adapter, updates booking to `REFUNDED`, and writes compensatory ledger entries.
5. In a simulated test case where cancellation is attempted 2 hours prior to session: system rejects refund request with notice: "Cancellations within 24 hours of scheduled time are non-refundable."

### 6. Estimated Complexity
- **M (Medium — 2 days)**

---

## Slicing Strategy Matrix Summary

| Slice | Name | Scope Highlights | Anti-Scope Highlights | Complexity | Target Days |
|---|---|---|---|---|---|
| **Slice 1** | Browse & Book (Seeded Walking Skeleton) | 3 seeded cards, profile, 1 service, 3 fixed slots, booking confirmation | No auth, no payments, no email, no search, no provider UI | **S** | Day 1–2 |
| **Slice 1.5** | Standalone Payment Rails Spike (Demo) | Standalone Stripe test route, PaymentIntent, webhook signature verification | No core booking linkage, no real money, no payouts, no disputes | **S** | Parallel (8h) |
| **Slice 2** | Learner Auth & Booking Lifecycle | Register, login, session JWT, "My Bookings", cancel action | No OAuth, no provider registration, no refunds, no email verification | **M** | Day 3 |
| **Slice 3** | Supply-Side Self-Service | Provider profile, service catalog, weekly recurring calendar, dynamic slot calculation | No background checks, no admin approval gate, no bank payouts | **M** | Day 4–5 |
| **Slice 4** | Real-Time Slot Hold & Concurrency | Redis atomic slot lock (10-min TTL), countdown UI, 409 conflict on race | No live payments, no WebSockets, no overbooking waitlists | **M** | Day 6–7 |
| **Slice 5** | Payments, Commission & Finalization | PaymentContract/MockAdapter, 20% platform split, 24h refund policy | No live Stripe merchant account, no automated bank payouts, no tax FX | **M** | Day 8–9 |
