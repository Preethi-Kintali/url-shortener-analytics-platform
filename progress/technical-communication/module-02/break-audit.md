# Module 02 – Step 5: BREAK – Broken Memo Communication Audit

## 1. The Buried Lede
- **Defect:** The core decision to migrate from REST to GraphQL is buried in the 4th paragraph, preceded by over 200 words of throat-clearing and contextual background.
- **Reader Impact:** Busy executives, technical leads, and new engineers miss the core takeaway if scanning quickly, wasting cognitive time trying to locate what actually changed.

## 2. Passive Voice & Hidden Accountability
- **Defect:** Pervasive passive constructions conceal the decision-makers and responsible owners:
  - *"A decision has been reached"* (By whom?)
  - *"It should be noted that..."* (Zero informational value)
  - *"Three engineers have been allocated..."* (Who allocated them?)
  - *"These risks will be monitored closely..."* (Who is monitoring? How? What alerts?)
  - *"Addressed as they arise..."* (What runbook or playbook handles them?)
- **Reader Impact:** Without explicit subjects, nobody owns action items or operational mitigations.

## 3. Undefined Jargon & Acronyms
- **Defect:** Dropping domain acronyms without definition:
  - **FE:** Frontend
  - **BFF:** Backend-for-Frontend (dedicated translation layer)
  - **SDK:** Software Development Kit
  - **SRE:** Site Reliability Engineering
  - **Aggregation endpoints:** Custom endpoints stitching multi-service payloads
- **Reader Impact:** Creates an artificial barrier to understanding for new hires like Priya, undermining onboarding and team alignment.

## 4. Structural Failures & Low Scannability
- **Defect:** Monolithic 5-paragraph wall of text with zero section headings, no bold keywords, and no bulleted lists.
- **Reader Impact:** Fails the 10-second test. Responders cannot quickly reference facts or execution timelines under pressure.

## 5. Wordiness & Throat-Clearing Filler
- **Defect:** Inflated corporate phrases adding syllable count without semantic value:
  - *"As many of you are aware..."*
  - *"After extensive deliberation and analysis of various factors..."*
  - *"It has been observed that..."*
  - *"Given these considerations..."*
  - *"Regarding risks, it has been acknowledged that..."*
- **Reader Impact:** Increases reading fatigue and obscures essential technical constraints.

## 6. Operational Ambiguity
- **Defect:** *"These risks will be monitored closely and addressed as they arise"* offers zero actionable safeguards.
- **Reader Impact:** Real production mitigation requires explicit controls: enforcing query depth limits to prevent nested query exhaustion, configuring persisted queries and response caching, and establishing milestone reviews.
