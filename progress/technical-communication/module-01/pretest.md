# Technical Communication — Module 01: Pretest (Starting Check)

## Question 1: Code Review
**Scenario:** Reviewing a pull request with deeply nested `if/else` logic instead of early returns/guard clauses.
> *"The code works correctly, but I think we can make it easier to read by using guard clauses (early returns) instead of multiple nested `if/else` blocks. This would reduce nesting and make the main logic easier to follow. Could we consider refactoring it this way?"*
- **Analysis:** Distinguishes between functional correctness and maintainability/readability style; constructive, actionable, and collegial tone.

---

## Question 2: Explaining an Architectural Decision
**Scenario:** Explaining to a non-technical Product Manager why a message queue is needed between Service A and Service B instead of direct HTTP calls.
> *"If Service A directly calls Service B, Service A has to wait until Service B finishes processing. If Service B is slow or temporarily unavailable, it can also affect Service A. A message queue allows Service A to send a request and continue its work while Service B processes it independently. This makes the system more reliable and helps both services handle traffic more smoothly."*
- **Analysis:** Zero jargon; focuses on resilience and decoupling (the "why" rather than technical mechanics); accessible explanation.

---

## Question 3: Weekly Status Update
**Scenario:** Writing a 1-paragraph status update regarding a 3-week search latency issue solved by indexing.
> ***Search performance has improved significantly:** latency dropped from 2.3 seconds to 180 milliseconds after we identified and fixed a database full table scan. Last Tuesday, we traced the issue to a query that was not using an appropriate index, and the index was added on Wednesday. The performance improvement is now visible, but monitoring and alerts still need to be implemented to detect slow queries before they affect users again.*
- **Analysis:** Leads with the high-impact outcome first; scannable; explicitly identifies ongoing mitigation (monitoring/alerts).

---

## Question 4: Incident Description
**Scenario:** 3-sentence summary for the VP of Engineering about a 45-minute login outage caused by an unsynced auth endpoint URL.
> *"Users experienced login failures between 2:15 PM and 3:00 PM following a deployment at 2:00 PM. The issue was caused by a change to the authentication endpoint URL without a corresponding update to the client application configuration. The configuration was corrected and deployed at 2:45 PM, and the service was fully restored by 3:00 PM."*
- **Analysis:** Exactly 3 sentences; VP audience awareness (user impact, root cause, timeline); strictly blameless systems description.

---

## Question 5: Documentation Instinct
**Scenario:** 1 page of documentation for an API before rolling off.
> *"I would create a one-page API integration guide because other engineering teams need to understand how to consume the service correctly. It would cover the API's purpose, available endpoints, required request parameters, authentication, request and response examples, common error codes, and any important limitations. I would also include a sample API call so developers can quickly understand how to integrate it without needing to ask the backend team for basic information."*
- **Analysis:** Consumer-centric documentation prioritization; targets practical integration blockers (auth, sample curl, error envelopes).
