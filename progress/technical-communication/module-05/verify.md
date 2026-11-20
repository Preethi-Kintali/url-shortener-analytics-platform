# Module 05 — VERIFY: Stakeholder Communication Audit

## 1. Check 1: The Opening Sentence Test

**Result: PASS**

- **Criteria:** The opening sentence must immediately answer *"Why should I stop what I am doing and read this?"* and must not contain engineering-centric jargon (*API, endpoint, microservice, tokenization, latency, refactor, deploy, schema, pipeline*).
- **Evidence:** *"We recommend shifting the public launch date of our upcoming subscription service by three weeks, moving our planned release from December 18, 2026 to January 8, 2027."*
- **Audit:** The statement leads immediately with the primary business outcome and operational impact. Zero forbidden technical terms are present. An executive or marketing stakeholder instantly grasps the core takeaway.

---

## 2. Check 2: The Jargon Scan

**Result: PASS**

- **Criteria:** Every technical concept must be replaced with plain language or accompanied by an intuitive, non-technical translation.
- **Evidence:**
  - *Payment tokenization* is translated using the coat check / ticket stub analogy (exchanging a raw card number for a randomized digital voucher).
  - *Token replay* is explained as an attacker photocopying a valid claim stub to fraudulently authorize repeat charges.
  - *Security severity* is contextualized using industry precedent (time-to-exploit post-disclosure) rather than abstract CVE scores.
- **Audit:** Zero unexplained technical jargon remains. The document successfully passes the "Parent Test."

---

## 3. Check 3: The Ask (Call to Action)

**Result: NEEDS IMPROVEMENT (Remediated)**

- **Criteria:** The document must culminate in clear, assignable, and deadline-driven requests rather than general status reporting.
- **Initial State & Evidence:**
  - Item 1 specified a concrete deadline for Product Leadership (sign-off by Monday, November 23 at 5:00 PM).
  - Item 3 specified a concrete meeting time (Monday, November 23 at 2:00 PM).
  - **Identified Gap:** Item 2 (*"Marketing Timeline Realignment: Marketing review to adjust promotional milestones, press announcements, and ad campaigns from mid-December to the week of January 8"*) lacked an assigned role owner and a specific delivery deadline. A passive departmental request creates operational ambiguity, allowing marketing realignment to slip.
- **Recommended Correction:** Assign the action specifically to the **Head of Marketing** with an explicit deliverable: an updated promotional calendar, ad flighting plan, and press embargo schedule delivered by **Tuesday, November 24, 2026 at 5:00 PM**.
- **Remediation:** `stakeholder-memo.md` was updated to incorporate this explicit ownership and deadline.

---

## 4. Check 4: Tone & Red Flags Audit

**Result: PASS**

- **Criteria:** The communication must avoid condescending meta-language (*"to put it simply for non-technical people..."*), avoid catastrophic hyperbole (not claiming an attack is inevitable), and treat stakeholders as professional peers with distinct domain expertise.
- **Evidence:** Section 3 uses a balanced retail store analogy (*"unlocked rear door"*) that illustrates the risk of high-traffic exposure without falsely claiming an exploit is guaranteed. Technical facts are translated respectfully and directly.
