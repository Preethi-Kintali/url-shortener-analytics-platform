# Module 02 – Step 5: BREAK Analysis
## The Circular Dependency Trap: Architectural Diagnosis

### 1. The Circular Deadlock
The addition of the administrative approval dashboard introduced a three-node deadlock cycle:
```text
Provider Vetting ──► (needs) ──► Admin Dashboard ──► (needs) ──► Provider Data ──► (needs) ──► Provider Vetting
```
- **Why Reordering Fails:** No sequence of `[Vetting, Dashboard, Data]` can execute linearly because every permutation contains an unsatisfied prerequisite. This is not a project scheduling error—it is an **ontological design flaw** in how provider records are defined.

---

### 2. Deconstructing the Flawed Assumptions

#### The Weakest Assumption: Conflating Data Existence with Public Activation
The assumption that *"Provider Data only exists after Provider Vetting is complete"* conflates two distinct concepts:
1. **Application Submission:** A prospective provider entering their bio, identity, and uploading credentials.
2. **Public Activation:** An approved provider being indexed in search and authorized to accept bookings.

An administrative reviewer cannot inspect documents or evaluate a candidate if the candidate's data does not exist in the database.

---

### 3. Architectural Resolution via Explicit State Machines

By replacing binary existence with a multi-state lifecycle machine, the circular dependency dissolves into a clean forward-progressing sequence:

```text
┌───────────────────────────────┐
│ Provider Application          │ ──► States: DRAFT, PENDING_REVIEW
└───────────────┬───────────────┘
                │ [H]
                ▼
┌───────────────────────────────┐
│ Admin Dashboard Vetting View  │ ──► Reads PENDING_REVIEW records
└───────────────┬───────────────┘
                │ [H]
                ▼
┌───────────────────────────────┐
│ Admin Approval Action         │ ──► Transitions status to APPROVED
└───────────────┬───────────────┘
                │ [H]
                ▼
┌───────────────────────────────┐
│ Public Catalog & Scheduling   │ ──► Queries WHERE status = 'APPROVED'
└───────────────────────────────┘
```

#### Lifecycle States:
- `DRAFT`: Provider is editing details prior to submission.
- `PENDING_REVIEW`: Application and credentials submitted; awaiting admin review.
- `UNDER_REVIEW`: Claimed by an admin officer.
- `APPROVED`: Verified; unlocked for public listings and availability calendar.
- `REJECTED`: Denied with explanatory feedback.
- `SUSPENDED`: Temporarily revoked due to disputes or policy infractions.

---

### 4. Non-Technical Stakeholder Communication (PM Framing)
> *"We are currently treating provider registration and provider approval as if they are the exact same step. But our admin team needs to view an applicant's profile and credentials in order to make a vetting decision. If we only create provider records after approval, the admin dashboard will have nothing to display.*
>
> *Instead, we will allow providers to submit an onboarding application that sits in a 'Pending Review' state. The admin dashboard will read these pending applications, allowing administrators to review and approve them. Once approved, the provider automatically becomes active in our public search. This gives us a clear operational workflow and lets us build onboarding and admin tools in parallel without blocking each other."*
