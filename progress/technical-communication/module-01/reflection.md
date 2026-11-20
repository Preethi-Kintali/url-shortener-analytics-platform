# Module 01 – Final Reflection: Code Review as Communication

## 1. Review Style Across Diff Scales
- **Large PR (15+ files, 500+ LOC):** Anchor on a structured summary highlighting overarching architecture, data flow, security/operational risks, and primary themes. Then pair this summary with targeted, file-specific inline comments prioritizing correctness, performance bounds, and contracts over minor stylistic preferences.
- **Small PR (5-line bug fix):** Keep review lean and highly targeted. Comment directly on changed lines, verify that the fix addresses root cause and edge cases, and eliminate superfluous procedural sections to maintain high developer velocity.

## 2. Tone vs. Technical Effectiveness
- **The Core Paradox:** Identifying a real technical defect is useless if delivery alienates the author. Aggressive or sarcastic phrasing induces defensive reactions, derails technical focus, and often blinds the reviewer to genuine correctness bugs (as seen in the broken review missing `ZeroDivisionError`).
- **Constructive Framing:** Explaining the underlying *why* and offering concrete drop-in alternatives empowers authors to understand and remediate defects quickly, preserving team psychological safety and code quality.

## 3. Code Review as Collaboration vs. Gatekeeping
- **Collaborative Engineering:** Code review is not a mechanism for personal gatekeeping or dogmatic style enforcement. It is a shared, empathetic discipline where teammates partner to make software robust, maintainable, secure, and clear.
- **Professional Standard:** Practicing and receiving feedback that is grounded in technical rationale, actionable suggestions, and mutual respect elevates overall engineering standards and team velocity.
