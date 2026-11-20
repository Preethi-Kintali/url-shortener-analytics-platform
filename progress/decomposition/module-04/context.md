# Module 04 – Step 1: CONTEXT
## Horizontal Layers vs. The Minimal Vertical Slice

### 1. Horizontal Architectural Decomposition
The capability *"A learner can book a service provider"* spans five distinct horizontal layers:

```text
┌─────────────────────────────────────────────────────────────┐
│ 1. Frontend UI Layer                                        │
│    Provider card, slot selection button, confirmation alert │
└──────────────────────────────┬──────────────────────────────┘
                               │ HTTP / JSON
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. Backend API / Transport Layer                            │
│    Route handler POST /api/bookings, auth token middleware  │
└──────────────────────────────┬──────────────────────────────┘
                               │ DTO Validation
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. Domain / Business Logic Layer                            │
│    Slot collision detection, state machine transition       │
└──────────────────┬───────────────────────────┬──────────────┘
                   │                           │
                   ▼                           ▼
┌─────────────────────────────┐ ┌─────────────────────────────┐
│ 4. External Integration     │ │ 5. Persistence / Database   │
│    Mock payment adapter,    │ │    PostgreSQL booking       │
│    event bus trigger        │ │    records, slot locks      │
└─────────────────────────────┘ └─────────────────────────────┘
```

---

### 2. The Minimal Vertical Slice Definition (Slice 1)
Rather than building every database model or every UI filter upfront, Slice 1 cuts a thin end-to-end thread across all 5 layers for **one specific user action**:

- **Target Persona & Scenario:** A learner books 1 session with 1 specific provider for 1 available slot.
- **In-Scope Boundary:**
  1. Seeded database record for 1 approved provider and 1 standard offering ($50 / 60 mins).
  2. 1 open availability slot: `2026-12-01T10:00:00Z`.
  3. Minimal web page displaying the provider, offering, and a single "Reserve Slot" CTA.
  4. Backend endpoint validating slot availability and executing an atomic insert.
  5. Deterministic mock payment completion (clearly marked `environment: 'sandbox'`).
  6. Instant confirmation screen showing unique `booking_id` and timestamp.
- **Explicit Anti-Scope (Deferred to Subsequent Slices):**
  - Multi-city search and category filters.
  - Dynamic recurring schedule editors.
  - Live Stripe production credit card capture.
  - Cancellation, refund, and dispute lifecycles.
  - Email notification delivery queues.
  - Provider dashboard analytics.

### 3. Engineering Justification
This slice proves that the database schema, domain validation, REST routing, and frontend state work harmoniously on Day 3. Any integration flaw or data mismatch is exposed immediately with near-zero refactoring cost.
