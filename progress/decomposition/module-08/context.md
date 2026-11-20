# Module 08: Integration & Verification — Step 1: CONTEXT

## 1. The Core Principle: Individual Correctness Does Not Guarantee System Correctness
In software engineering, integration is an independent, critical discipline. Components can pass 100% of their isolated unit test suites and satisfy ticket acceptance criteria in silos while failing catastrophically upon cross-service connection.

### The Historical Lesson: Healthcare.gov (October 1, 2013)
- 55 independent contractors built separate components in organizational silos.
- Each contractor tested their module against localized unit test suites and claimed completion.
- However, zero cross-contractor integration testing was conducted until launch week.
- On launch day, the $1.7B system crashed under five concurrent users because nobody owned the integration boundary seams.

---

## 2. Micro-Exercise: Diagnosing the Integration Seam Bug
**Scenario:**
- **Booking Service API (Stream A):**
  - Response: `{ booking_id: uuid, status: "confirmed", created_at: "2025-03-15T14:30:00Z" }` (ISO-8601 UTC string).
- **Notification Service API (Stream B):**
  - Request: `{ booking_id: uuid, created_at: number, provider_id: uuid }` (Unix epoch timestamp in seconds/milliseconds).

### Diagnostic Finding:
- Both services are internally consistent and pass localized unit tests.
- When connected, Stream B's type validator rejects Stream A's payload (HTTP 400), or Javascript silently parses the date string into `NaN`, corrupting email notifications and provider scheduling.
- **Root Cause:** Semantic type mismatch in the contract seam across independent streams.

---

## 3. The Discipline of Requirements Traceability
Requirements traceability tracks every requirement from its origin (Module 01 requirements extraction) through the dependency graph (Module 02), vertical slices (Module 04), task tickets (Module 05), and mid-build adaptations (Module 07) to final verification.

In decomposition, requirements can be lost, drifted, or accidentally de-scoped. Module 08 provides the rigorous auditing framework to verify that the integrated product delivers what was originally promised alongside the adapted enterprise capabilities.
