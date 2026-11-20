# SkillSwap — Mid-Build Adaptation Verification (Module 07 Step 4)

## 1. Impact Statement Audit & PM Communication Evaluation

### Out-Loud Impact Statement Review:
> *"With the addition of the Meridian Corp enterprise requirement and our compressed 6-day investor demo deadline, here is where we land: the demo will showcase the complete core booking flow plus functional company-account delegation, allowing a corporate manager to book and fund sessions on behalf of their employees. To protect this timeline and ensure rock-solid stability, we have cut custom provider slot-creation tools, live Stripe merchant onboarding, and provider analytics from the 6-day scope; all three are scheduled to ship in our post-demo sprint cycle. The primary risk item is our confirmation notification flow—if cross-team email delivery testing runs behind on Day 4, we will fall back to an immediate in-app confirmation modal for the presentation. I need one concrete action from you today: connect us directly with the Meridian technical contact to confirm that our delegation data shape (`booked_for_name` and `booked_for_email`) satisfies their initial pilot and reimbursement audit requirements."*

### Evaluation from a Non-Technical PM's Perspective:
1. **What They Are Getting (Crystal Clear):**
   - End-to-end individual learner booking.
   - Working company-account delegation where a corporate user books on behalf of a colleague.
   - Live clickthrough demonstration ready for investors on Day 6.
2. **What They Are Giving Up (Explicit with Rescheduling):**
   - Custom provider availability slot editor $\to$ Rescheduled to Post-Demo Sprint 1.
   - Live multi-party Stripe payout pipeline $\to$ Rescheduled to Post-Demo Sprint 1.
   - Provider earnings and analytics dashboards $\to$ Rescheduled to Post-Demo Sprint 2.
3. **What Is at Risk & The Contingency:**
   - Outbound transactional email delivery. If cross-network SMTP latency or deliverability blocks on Day 4, system gracefully falls back to an immediate, polished in-app confirmation modal. The demo is completely protected.
4. **Actionable Ask:**
   - Single immediate action: Introduce engineering to Meridian's technical liaison today to validate the `booked_for_*` schema.

---

## 2. Defense of the Cuts & Dependency Audit

When time is compressed from weeks to 6 days, cutting features without auditing downstream dependencies causes catastrophic presentation failures. Here is the dependency audit for each cut:

### Cut 1: Slice 3 (Custom Provider Slot Management UI)
- **Why it was the right cut:** Building a dynamic recurring calendar editor (weekly recurring rules, time-zone math, exception dates) is complex frontend work (~15–20 hours) that does not serve the primary investor story.
- **Dependency Audit:**
  - *What depended on it?* The booking flow reads available slots from the database.
  - *How does the system work without it?* Slot availability is pre-seeded in the database via migration `001` and `TICK-01` (`bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb01` for Marcus). The booking flow queries existing slots normally. Zero runtime dependencies broken.

### Cut 2: Slice 4 (Redis Distributed Concurrency Hold)
- **Why it was the right cut:** Setting up a managed Redis cluster, distributed lock leases, and background expiry workers consumes 2–3 days of infrastructure setup.
- **Dependency Audit:**
  - *What depended on it?* Protection against simultaneous race-condition double bookings.
  - *How does the system work without it?* Concurrency is enforced at the PostgreSQL layer via atomic conditional updates:
    `UPDATE slots SET status = 'BOOKED' WHERE id = $1 AND status = 'AVAILABLE';`
    with `rowCount === 1` assertion (tested and verified in Module 06). During the scripted single-user investor demo, zero concurrent requests will occur. Database integrity is preserved.

### Cut 3: Slice 5 (Live Stripe Escrow & Payout Webhooks)
- **Why it was the right cut:** Stripe Connect merchant verification, webhook endpoint security, and bank payout rails require external KYC documentation and live merchant accounts (a known external blocker identified in Module 03).
- **Dependency Audit:**
  - *What depended on it?* The checkout step in the booking flow.
  - *How does the system work without it?* The booking modal executes a simulated payment confirmation handler that records the booking with payment status `'CONFIRMED'` without making external network calls. Investors evaluate marketplace liquidity and corporate delegation value, not third-party banking integration.

---

## 3. Blast Radius Justification: The Booking Flow (API & UI)

The **Booking Flow** is the single component classified as **MAJOR** blast radius.

### Why MAJOR (vs. MINOR)?
- **Cross-Layer Coupling:** The change spans database migrations (`004_add_delegation_to_bookings.sql`), controller validation schemas (`CreateBookingDto`), business logic authorization checks, and frontend UI components (`ProviderProfileView.tsx`).
- **Authorization & Security Guarding:** Unlike simple profile fields, delegation allows one user to initiate transactions attributed to another person. The backend cannot simply store whatever strings the client sends; it must enforce:
  1. Requester must be authenticated (`req.user` present).
  2. Requester must possess `can_book_for_others === true`.
  3. Both `booked_for_name` and `booked_for_email` must be validated (RFC 5322 email syntax).
  4. If an unauthorized user attempts to pass delegation fields, the API must reject with `HTTP 403 Forbidden`.
- **UI State Machine Complexity:** The frontend modal must dynamically toggle between standard individual booking mode and corporate delegation mode based on the logged-in user's JWT claims, while maintaining validation state across both tabs.

### Confidence Level & Potential Hidden Risks:
- **Confidence Level:** **High (90%)**. The Minimal Bridge deliberately avoids multi-tenant database foreign keys, keeping the schema change additive and backward-compatible.
- **Where Hidden Complexity Could Emerge:**
  1. *Email Notifications:* If Meridian expects Sarah (the employee) to receive a calendar invitation directly at `booked_for_email`, SMTP deliverability must be tested early.
  2. *Reimbursement Receipts:* If Meridian's finance team requires company tax IDs on payment confirmation receipts, we must ensure the receipt modal displays `company_name` alongside the booking reference.
