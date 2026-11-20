# Module 01 – Step 5: BREAK – Broken Code Review Analysis

## 1. Hostile Tone & Emotionally Charged Language
- **Sarcasm & Condescension:** Phrases like *"Are we writing code in 1995?"*, *"have you never heard of iterating directly over a list?"*, and *"This is Python 101"* shift feedback from technical critique to personal belittlement.
- **Dismissive Gatekeeping:** Statements like *"This is a mess"* and *"This is not how we do things"* assert authority without technical justification, shutting down learning and constructive dialogue.

## 2. Absence of Actionability & Constructive Alternatives
- **Vague Demands:** Commands like *"Refactor the whole thing"* and *"Just make a dataclass"* provide no guidance on target architecture, schema, or implementation steps.
- **Missing Concrete Examples:** The reviewer points out flaws without providing constructive drop-in alternatives (e.g., failing to suggest `active_count` / `inactive_count`, `for user in users`, or extracting health classification into a helper function).

## 3. Catastrophic Prioritization Failure (The Blind Spot)
- **Obsession with Syntax vs. Correctness:** The reviewer burned all cognitive bandwidth on variable names and list iteration idioms, completely missing two critical functional bugs:
  1. **Runtime Crash:** `total_age / cnt` raises a fatal `ZeroDivisionError` whenever active user count is zero.
  2. **Logic Inconsistency:** `total_age` accumulates ages across all users while dividing strictly by active users.
- Stylistic preferences were elevated above production crash risks.

## 4. Organizational & Velocity Impact
- **Erosion of Psychological Safety:** Authors on the receiving end experience defensiveness, hesitation, and dread when opening future pull requests.
- **Slower Delivery:** Developers withhold early work, delay reviews, and spend excessive time micro-polishing harmless details out of fear of public humiliation, directly harming overall team delivery velocity.
