# Module 01 — Quick-Pass Starter Requirements

## 1. Five Explicit Requirements from the Specification
1. Learners must be able to search and browse service providers filtered by category with sub-second responsiveness.
2. Learners must be able to view provider profiles containing historical star ratings, client reviews, and verified credentials.
3. Learners must be able to reserve available time slots and complete payments directly through the platform.
4. Providers must be able to define their own availability calendar, service descriptions, and hourly/session pricing.
5. The platform must automatically deduct a 15% marketplace commission on completed bookings before disbursing provider earnings.

---

## 2. Two Ambiguities of Highest Operational Risk
1. **Concurrency & Double-Booking Semantics:** The spec states that users can book time slots, but does not define how simultaneous booking attempts for the same time slot are serialized or held while payment is entered.
2. **Cancellation & Financial Refund Hierarchy:** The spec mentions that cancellations apply the "provider's cancellation policy," but does not specify whether policies are structured tiers (e.g. 24h full refund vs 50% cutoff) or free-text descriptions, nor how payment processing fees are treated during refunds.

---

## 3. Top Priority Question for the Product Manager (PM)
> *"For the 5-city expansion target within 6 months: do these cities operate under distinct legal tax jurisdictions, localized currencies, and separate service categories, or can all five cities share a unified single-currency catalog with a simple `city_id` tenant partition?"*
