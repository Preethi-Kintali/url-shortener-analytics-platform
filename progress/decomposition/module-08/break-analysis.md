# SkillSwap — Seam Status Mismatch Break Analysis (Module 08 Step 5)

## 1. Incident Summary: The Missing Dashboard Bookings Defect
Immediately following integration, testing revealed a critical boundary defect:
> **Symptom:** *Learners successfully create and pay for bookings, and rows appear in the `bookings` database table with HTTP 201 responses. However, when the provider logs into their dashboard, the booking list table is completely empty.*

---

## 2. Root Cause Diagnosis & Boundary Seam Analysis
- **Booking Creation Service Implementation:**
  The booking service inserts new records according to Contract B with booking lifecycle status `'CONFIRMED'` (or `'confirmed'`):
  ```sql
  INSERT INTO bookings (..., status) VALUES (..., 'CONFIRMED');
  ```
- **Provider Dashboard Query Implementation:**
  The provider dashboard service was developed against a separate ticket specification that queried for "active" bookings:
  ```sql
  SELECT * FROM bookings 
  WHERE provider_id = :provider_id AND status = 'active';
  ```
- **The Divergence:** 
  The two components represent the identical business concept (*"a valid, scheduled session that should be displayed to the provider"*) using two completely different enum strings: `'CONFIRMED'` vs. `'active'`.
  Because SQL evaluates `'CONFIRMED' = 'active'` as false, the dashboard query returns zero rows.

---

## 3. The Illusion of Individual Correctness
This defect exposes why isolated unit testing is fundamentally insufficient for distributed systems:
1. **Booking Service Unit Tests:** Mocked the database or asserted that `INSERT INTO bookings` succeeded. All tests passed 100%.
2. **Provider Dashboard Unit Tests:** Seeded local mock bookings with `status = 'active'` and verified that the dashboard rendered them in a table. All tests passed 100%.
3. **The Seam Failure:** Neither component was broken. Both followed their individual local specifications. The bug existed solely in the unverified seam between the two services.

*Core Principle Proven:* **Individual correctness does not guarantee system correctness.**

---

## 4. Resolution Plan for Step 6 (FIX)
1. **Canonical Booking State Machine Enforcement:**
   Formally declare the booking lifecycle enum in shared contracts (`@skillswap/contracts`):
   ```typescript
   export enum BookingStatus {
     PENDING = 'PENDING',
     CONFIRMED = 'CONFIRMED',
     CANCELLED = 'CANCELLED'
   }
   ```
2. **Clear Separation from Slot Availability States:**
   - **Slot State Machine:** `AVAILABLE` $\to$ `HELD` $\to$ `BOOKED`
   - **Booking Lifecycle State Machine:** `PENDING` $\to$ `CONFIRMED` $\to$ `CANCELLED`
3. **Patch Provider Dashboard Query:**
   Update the provider dashboard query to filter for the canonical status:
   ```sql
   SELECT * FROM bookings 
   WHERE provider_id = :provider_id AND status = 'CONFIRMED';
   ```
4. **Automated Cross-Service Integration Test:**
   Execute `TEST-INT-01` verifying that a booking created via `POST /api/v1/bookings` immediately appears in the provider dashboard query response.
