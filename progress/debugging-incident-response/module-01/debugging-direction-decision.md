# Debugging & Incident Response — Module 01 Step 2: DECIDE (Debugging Direction)

**Session ID**: `nio880GmEu6L7HqkpqO90`  
**Skill**: Debugging & Incident Response (`debugging-incident-response`)  
**Pack**: Launchpad (`spk_debugging_incident_response_launchpad`)  
**Module**: Module 01 — Hypothesis-First Debugging  
**Step**: Step 2: DECIDE (`decide`)  
**Decision**: **Option A (Top-Down Debugging)**  
**Recorded Key**: `decisions.module_01.debugging_direction = "A"`  

---

## 1. Context & Trade-Off Analysis

| Dimension | Option A: Top-Down Debugging (Symptom → Cause) | Option B: Bottom-Up Debugging (Changes → Symptom) |
|---|---|---|
| **Starting Point** | The observable startup error message and stack trace. | Recent git commits, deployment diffs, and config commits. |
| **Investigation Flow** | Pulling the thread backward: Exception → Frame → Function → Caller → Input. | Tracing forward: Commit diff → Modified module → Blast radius → Affected endpoints. |
| **Strengths in Inherited Outages** | **High Velocity**: When a service crashes on startup, the fatal error message pinpoints the failing subsystem immediately, bypassing hundreds of unfamiliar files. | Useful when a known deploy just shipped and the diff is concise (< 50 lines). |
| **Failure Modes** | Misleading error messages (e.g. `ECONNREFUSED` masking a bad connection string). | Noise and fatigue: In an inherited codebase with no handoff and many commits, tracing forward wastes hours on irrelevant changes. |
| **Applicability to linkops** | **Optimal**: We inherited the codebase today with no handoff, and the service crashes immediately on bootstrap. | Suboptimal: Requires deep historical context and clean commit logs that we do not currently possess. |

---

## 2. Decision Rationale

I choose **Option A (Top-Down Debugging)**.

1. **Concrete Startup Signal**: The service is actively crashing on startup. In startup crashes, the runtime runtime engine (Node.js/container) produces an immediate, high-fidelity stack trace or fatal exit code. Tracing backward from that specific error frame directly isolates the failing configuration key or unhandled initialization call in seconds.
2. **Context Asymmetry**: Because the colleague departed without a handoff document or runbook, attempting bottom-up analysis across months of unknown git commits would lead to speculative thrashing. Top-down anchors the investigation in empirical runtime facts.
3. **Guard Against Misleading Errors**: While top-down can be misled by generic error wrappers, we will apply hypothesis testing: treat the error message as a symptom, formulate a falsifiable hypothesis, and verify underlying assumptions (e.g., verifying port/network before assuming database crash).
