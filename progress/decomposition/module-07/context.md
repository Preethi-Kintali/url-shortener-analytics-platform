# Module 07: Mid-Build Adaptation — Step 1: CONTEXT

## 1. The Reality of Mid-Build Requirements Change
In production software engineering, requirements change is inevitable. When market conditions shift, client demands emerge, or business constraints pivot, engineers cannot expect stable ground. 

There are three common responses to mid-build requirement shifts:
1. **Panic & Restart (Wrong):** Tearing up the plan and restarting from scratch. This discards completed work and sinks into analysis paralysis.
2. **Denial & Absorption (Wrong):** Blindly cramming new requirements into the existing schedule without adjusting scope, dates, or resources, leading to crunch, broken contracts, and silent failures.
3. **Assessment & Adaptation (Correct — The GPS Navigation Model):** When a driver misses a turn, the GPS does not route back to the trip origin or shut down; it recalculates the optimal route to the destination from the current position. In engineering, we recalculate from our current build state.

---

## 2. Micro-Exercise: Blast Radius Analysis
**Scenario:**
- **Ticket A:** User Authentication — **DONE** (Users can sign up, log in, receive JWT).
- **Ticket B:** Service Listing Page — **IN PROGRESS (70% done)** (Providers listed with category and ratings; search working; pagination pending).
- **Ticket C:** Booking Flow — **NOT STARTED** (Provider selection, slot picker, booking confirmation).

**Requirement Change:** *"Users need to see provider availability directly on the listing page before clicking into a provider's profile."*

### Blast Radius Assessment:
1. **Ticket A (User Authentication): UNTOUCHED (Zero Blast Radius)**
   - *Rationale:* Authentication boundaries, token claims, and session filters do not depend on or interact with availability presentation.
2. **Ticket B (Service Listing Page): DIRECT HIT (High Blast Radius)**
   - *Impacts:*
     - API contract change: `GET /api/v1/services` must now return aggregated availability metadata (e.g., `next_available_slot` or `has_availability_today: boolean`).
     - Backend query performance: Requires optimized join or Redis lookup to prevent $N+1$ queries across provider cards.
     - Frontend UI component: Provider card component must be modified to render availability badges before search pagination is completed.
3. **Ticket C (Booking Flow): PARTIALLY AFFECTED (Medium Blast Radius)**
   - *Impacts:*
     - Availability fetching logic previously designed exclusively for the provider detail view moves earlier in the user journey.
     - The detail view can now be simplified or optimized for granular time selection rather than initial availability discovery.
     - Interface contract between listing and detail view must ensure consistent availability state representations.
