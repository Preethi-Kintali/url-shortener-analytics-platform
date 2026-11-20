# Module 04: Incident Postmortems — DECIDE

## Decision: Option A — Timeline-Based Postmortem (`timeline_based`)

### Strategic Rationale
A timeline-based postmortem reconstructs the exact sequence of events from trigger through detection and recovery to expose response gaps, combined with Five-Whys depth to uncover systemic causes without oversimplifying multi-factor failures.

### Key Factors Considered
1. **Incident Complexity & Visibility:** Chronological tracking captures the exact time delta across deploy (14:00), first customer signal (14:22), investigation start (14:38), database discovery (14:55), failed rollback (15:08), and manual resolution (16:02). This exposes monitoring blind spots and triage delays that a purely abstract root-cause discussion would gloss over.
2. **Root-Cause Depth via Hybrid Synthesis:** While the timeline establishes the factual chronology of what occurred, embedding a Five-Whys causal interrogation at critical inflection points ensures we do not stop at the superficial trigger (config removal), but probe deep into exception swallowing, schema drift, and validation gaps.
3. **Actionable Accountability:** Exposing the exact detection and recovery gaps provides objective justification for concrete preventative action items—specifically business-level alerting, automated rollback testing, and staging/production schema parity.
