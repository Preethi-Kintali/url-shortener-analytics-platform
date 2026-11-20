# SkillSwap Requirements Specification & Categorized Matrix

## Executive Summary
This document captures the formal requirements extraction for **SkillSwap**, a two-sided marketplace connecting skill providers with learners. Requirements were extracted through three rigorous analytical passes:
1. **The Verb Pass:** Actions and functional capabilities the system must execute.
2. **The Qualifier Pass:** Adjectives, bounds, and metrics dictating quality attributes and constraints.
3. **The Silence Pass:** Missing architectural essentials (auth, dispute lifecycles, payout scheduling, idempotency, data partitions).

---

## 1. Categorized Requirements Matrix

| ID | Requirement Statement | Type | Stakeholder | Source & Lineage | Status & Confidence | Architectural Implication |
|---|---|---|---|---|:---:|---|
| **REQ-01** | Learners must be able to search and browse providers filtered by service categories. | Functional | Learner | Para 1 (Explicit) | Active / High | Category taxonomy, indexed filter queries, read replicas. |
| **REQ-02** | Provider search and filter queries must return results in under 200ms under load ("feel instant"). | Quality Attribute | Learner | Para 1 (Explicit qualifier) | Active / High | Caching layer (Redis), composite database indexes on `(category_id, city_id)`. |
| **REQ-03** | Learners must be able to view public provider profiles displaying bios, verified badges, aggregate star ratings, and historical reviews. | Functional | Learner | Para 1 (Explicit) | Active / High | Denormalized rating aggregates on provider entity to avoid on-the-fly table scans. |
| **REQ-04** | Learners must be able to select an open provider time slot and place a temporary 10-minute hold while checkout is initiated. | Functional | Learner | Para 1 (Implicit from booking flow) | Active / Medium | Distributed lock / temporary lease state machine (`HELD` status with TTL). |
| **REQ-05** | The system must prevent simultaneous duplicate bookings for the identical time slot (Zero Double-Booking). | Quality Attribute | Learner / Provider | Para 1 (Implicit constraint) | Active / High | Database unique constraint on `(provider_id, slot_start_time)` with serializable isolation. |
| **REQ-06** | Learners must be able to complete payment for booked sessions via credit/debit rails through the platform. | Functional | Learner | Para 1 (Explicit) | Active / High | Payment gateway integration (Stripe/Adyen), webhook listener, idempotency keys. |
| **REQ-07** | Learners and providers must receive asynchronous email confirmation upon successful booking and payment capture. | Functional | Learner / Provider | Para 1 (Explicit) | Active / High | Background job queue (BullMQ/Redis) with retry backoff; decoupled from checkout HTTP cycle. |
| **REQ-08** | Learners must be able to cancel bookings with defined refund outcomes. | Functional | Learner | Para 1 (Contradictory Update) | **BLOCKED - pending PM decision** / Low | **BLOCKED:** Direct contradiction between Provider Autonomy vs Universal Platform 24h refund rule. Awaiting PM decision between Option 1 & Option 2. |
| **REQ-09** | Providers must be able to define custom recurring and ad-hoc availability schedules and session durations. | Functional | Provider | Para 2 (Explicit) | Active / High | Calendar engine with timezone offset normalization (UTC persistence). |
| **REQ-10** | Providers must be able to configure their own hourly or per-session service rates and descriptive offerings. | Functional | Provider | Para 2 (Explicit) | Active / High | Pricing validation schema (minimum floor to cover payment processing fees). |
| **REQ-11** | Providers must have access to a dedicated dashboard displaying upcoming bookings, historical earnings, and customer reviews. | Functional | Provider | Para 2 (Explicit) | Active / High | Materialized view / read-model optimizing provider analytics aggregation. |
| **REQ-12** | The platform must deduct an immutable 15% marketplace commission on gross session value prior to provider payout disbursement. | Constraint | Platform / Ops | Para 2 (Explicit) | Active / High | Ledger accounting service; immutable transaction ledger table storing net earnings and fees. |
| **REQ-13** | Providers must be able to flag learners who fail to attend scheduled sessions ("no-show" reporting). | Functional | Provider | Para 2 (Explicit) | Active / High | Flagging workflow triggering dispute review and automated forfeit of learner refund. |
| **REQ-14** | All new provider accounts must undergo an administrative vetting and credential verification workflow before their profiles become publicly bookable. | Constraint | Platform / Admin | Para 2 & 3 (Explicit) | Active / High | Provider status machine (`PENDING_VETTING`, `APPROVED`, `REJECTED`, `SUSPENDED`). |
| **REQ-15** | Platform administrators must have a centralized tooling console to review provider onboarding applications, inspect audit logs, and approve/reject profiles. | Functional | Platform / Admin | Para 3 (Explicit) | Active / High | Admin role-based access control (RBAC), audit logging of administrative actions. |
| **REQ-16** | Platform administrators must be able to mediate and resolve escalated billing and session disputes between learners and providers. | Functional | Platform / Admin | Para 3 (Explicit) | Active / High | Dispute ticket lifecycle, partial refund triggers, administrative payout hold overrides. |
| **REQ-17** | The system must ingest and record telemetry on all critical lifecycle events (searches, slot views, booking drops, payment attempts, cancellations). | Quality Attribute | Platform / Ops | Para 3 (Explicit "analytics on everything") | Active / Medium | Structured event stream (async ingestion queue) decoupling telemetry writes from API traffic. |
| **REQ-18** | The platform architecture must support multi-city deployment (expanding to 5 cities in 6 months) without requiring core data model or code rebuilds. | Constraint | Platform / Architecture | Para 3 (Explicit qualifier) | Active / High | Tenant partition key `city_id` on all geographical entities; timezone-aware scheduling. |
| **REQ-19** | The service must reliably handle thousands of concurrent users in the initial city launch without performance degradation. | Quality Attribute | Platform / Architecture | Para 3 (Explicit qualifier) | Active / Medium | Connection pooling, Redis query caching, stateless horizontal scaling behind load balancer. |
| **REQ-20** | Secure user authentication and authorization must segregate Learner, Provider, and Admin capabilities, preventing Insecure Direct Object References (IDOR). | Constraint | Platform / Security | Para 1-3 (Implicit silence) | Active / High | JWT-based auth tokens with cryptographic claims, strict tenancy and ownership middleware. |

---

## 2. Policy Contradiction Resolution: REQ-08 (Cancellation & Refund Policy)

### 2.1 The Core Contradiction
- **Rule A (Original Spec):** *"Cancellations follow the individual provider's cancellation policy."*
- **Rule B (Operations Update):** *"All cancellations made within 24 hours of booking receive a full refund, regardless of the reason; after 24 hours non-refundable."*
- **The Conflict:** Rule A delegates cancellation and refund terms entirely to providers. Rule B imposes a rigid, platform-wide blanket refund rule that strips provider autonomy and creates severe edge cases (e.g., booking a slot 2 hours in advance and cancelling immediately for a 100% refund, leaving the provider uncompensated).

### 2.2 Concrete Options for PM Decision

#### Option 1: Platform-First Universal Cancellation Policy
- **The Rule:** The platform establishes a single uniform cancellation policy across all providers.
  - Cancellations occurring $\ge 48\text{ hours}$ before the scheduled session start receive a 100% refund (minus payment processing pass-through fee).
  - Cancellations occurring between 24 and 48 hours receive a 50% refund.
  - Cancellations occurring $< 24\text{ hours}$ before the scheduled session start are 0% non-refundable, with 85% paid to the provider and 15% retained as platform commission.
  - A statutory 1-hour "grace window" immediately following checkout allows 100% cancellation regardless of session time (unless session starts in $<2\text{ hours}$).
- **Stakeholder Impact:**
  - *Learners:* Predictable, transparent experience across all bookings.
  - *Providers:* Stripped of pricing autonomy on cancellations; may reject same-day bookings if lead times are too short.
- **Trade-off & Implementation Complexity:** Low architectural complexity. Single rule engine, single database schema, simple UI messaging. Trades away supply-side provider flexibility in favor of demand-side UX simplicity.

#### Option 2: Provider Tiered Policy with Platform Cooling-Off Floor (Recommended)
- **The Rule:** Providers choose from three standardized platform-vetted tiers when publishing services:
  - *Tier 1 (Flexible):* Full refund up to 24 hours before session start.
  - *Tier 2 (Moderate):* Full refund up to 72 hours before start; 50% refund between 24 and 72 hours; non-refundable within 24 hours.
  - *Tier 3 (Strict):* 50% refund up to 7 days before start; non-refundable within 7 days.
  - *Platform Floor / Safeguard:* Any cancellation within **2 hours of initial booking creation** ("cooling-off window") receives a 100% refund, provided the session start time is at least 12 hours away.
- **Stakeholder Impact:**
  - *Learners:* Fair protection against accidental bookings; clear policy display prior to checkout.
  - *Providers:* Retain control over their commercial terms based on preparation time and schedule scarcity.
- **Trade-off & Implementation Complexity:** Medium-high complexity. Requires policy tier enumeration on service offerings, dynamic countdown timers on learner booking dashboards, multi-tier refund calculation logic, and audit trail of policy snapshot at time of booking (preventing retroactive provider changes).

### 2.3 Downstream Blast Radius & Affected Requirements
A decision between Option 1 and Option 2 directly impacts several other modules and requirements:
1. **REQ-06 (Payment Processing):** Determines whether card transactions are immediately captured or placed on an authorization hold until the cancellation cooling-off window expires.
2. **REQ-09 & REQ-10 (Provider Settings):** Determines whether provider service creation forms require cancellation tier configuration UI.
3. **REQ-11 (Provider Earnings Dashboard):** Requires displaying earnings in categorized states: `Pending Escrow` (within refund window), `Available for Payout` (cleared session), and `Forfeited/Refunded`.
4. **REQ-12 (Platform Commission):** Governs whether the 15% platform fee is refunded during cancellation, or retained to cover non-refundable Stripe/payment processing fees.
5. **REQ-16 (Dispute Resolution):** Sets the baseline rules for admin mediation when sessions are cancelled due to unforeseen emergencies or technical failures.

---

## 3. Architectural Requirement Tensions (Going Deeper)

In addition to explicit binary contradictions, the SkillSwap specification exhibits deep **architectural tensions**—opposing requirements pulling the system design in competing directions:

### Tension 1: Provider Availability Autonomy vs High-Concurrency Scale (REQ-09 vs REQ-19 / REQ-05)
- **The Pull:** Providers expect full autonomy to edit, block, and split calendar slots on the fly (REQ-09). Concurrently, the platform must support thousands of simultaneous learners searching and booking slots with zero double-booking (REQ-05, REQ-19).
- **The Conflict:** If availability queries read directly from a normalized schedule table, high write contention (providers adjusting slots while hundreds of learners initiate checkout holds) causes database lock contention and p95 latency spikes.
- **Design Resolution:** Decouple calendar authoring from calendar consumption using an event-driven slot projection model with distributed Redis TTL leases (`HELD` state for 10 minutes) backed by serializable row-level locks on commit.

### Tension 2: Instant Frictionless Checkout vs Anti-Fraud Escrow & Payout Safety (REQ-06 vs REQ-12 / REQ-14 / REQ-16)
- **The Pull:** Growth marketing demands 1-click frictionless checkout ("feel instant", REQ-02, REQ-06). Risk and operations require preventing fraudulent providers from booking fake sessions and immediately cashing out.
- **The Conflict:** Instant payout creates vulnerability to chargebacks, no-shows, and dispute clawback failures.
- **Design Resolution:** Adopt a two-phase settlement pipeline: immediate learner payment capture into platform custodial escrow, with provider payout disbursement scheduled $T+24\text{ hours}$ after verified session completion (or after dispute resolution window expires).

### Tension 3: "Analytics on Everything" Telemetry vs Sub-200ms Latency SLA (REQ-17 vs REQ-02)
- **The Pull:** Ops and product require granular telemetry on every search filter, impression, click, hold drop, and cancellation (REQ-17). Concurrently, search queries must return in $<200\text{ms}$ (REQ-02).
- **The Conflict:** Synchronous writes to an analytics database during user search or booking cycles degrade API latency and introduce external points of failure.
- **Design Resolution:** Strictly asynchronous fire-and-forget telemetry. API handlers emit lightweight event payloads to an in-memory buffer / Redis stream, processed out-of-band by background workers without blocking the HTTP request/response loop.

---

## 4. Ambiguities & Open Questions for the Product Manager

### Question 1: Cancellation Policy Decision (REQ-08)
- **Context:** Resolving the conflict between provider cancellation policy autonomy and uniform platform refund guarantees.
- **Question:** *"Does the business approve Option 1 (Platform-First Universal Policy) or Option 2 (Provider Tiered Policy with Platform Cooling-Off Floor)? If Option 2, should the cooling-off window be 1 hour or 2 hours?"*

### Question 2: Provider Payout Timing & Financial Custody (Escrow)
- **Context:** REQ-12 specifies 15% commission but omits disbursement timing.
- **Question:** *"Are provider payouts held in escrow until 24 hours post-session completion to allow learners time to file disputes or report provider no-shows?"*

### Question 3: Multi-City Scope & Geographic Isolation (REQ-18)
- **Context:** Expansion to 5 cities in 6 months.
- **Question:** *"Are the 5 expansion cities within the same country sharing currency (USD) and legal terms, or do we require multi-currency and regional tax compliance from Day 1?"*

### Question 4: Booking Model (Instant vs Request)
- **Context:** REQ-04 / REQ-06 booking lifecycle.
- **Question:** *"Is booking strictly instant-book (immediate slot reservation upon payment), or do providers have an acceptance window (e.g., 12 hours) to approve or decline the session?"*
