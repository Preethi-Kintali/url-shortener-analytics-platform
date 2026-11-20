# Module 03 FIX: Trace to Missing Context & Architectural Guardrails

## 1. Precise Statement of the Convention Violation

In Module 03 Step 5 (BREAK), we identified a critical architectural divergence:
- **The Violation:** The AI agent generated an endpoint that returned an ad-hoc error response:
  ```json
  {
    "status": "error",
    "message": "Team name is required.",
    "statusCode": 400
  }
  ```
  instead of adhering to the canonical project error envelope:
  ```json
  {
    "error": {
      "code": "VALIDATION_ERROR",
      "message": "Team name is required.",
      "request_id": "req_8e4a91c2b53f"
    }
  }
  ```
- **Consequence:** This divergence breaks client applications whose response interceptors expect `response.data.error.message`, drops distributed tracing (`request_id`), and bypasses centralized structured logging and sensitive data redaction.

---

## 2. Detective Work: Tracing the Violation to Missing Context

Why did the agent produce this violation? Reverse-engineering the agent's failure reveals three distinct context omissions:

### Root Cause 1: Missing Error Envelope Specification in System Context
While `system-context.md` previously mentioned built-in exception classes (`BadRequestException`, `NotFoundException`), it did not define the TypeScript interface for `SafeErrorEnvelope`. Without the formal interface contract, the agent had no semantic anchor for the wire payload structure.

### Root Cause 2: Missing Serialization Pipeline Context
The context packages omitted the explanation of **how** error formatting works in NestJS. The agent assumed the controller/service was responsible for formatting the JSON error body, rather than understanding that a globally bound `AllExceptionsFilter` (`APP_FILTER` in `AppModule`) intercepts unhandled exceptions, maps them to canonical machine-readable codes, attaches `request_id`, and serializes the response.

### Root Cause 3: Absence of Negative Constraints and Exemplars
The task prompts in `context-packages.md` only specified positive requirements ("throw BadRequestException"). There was no negative constraint prohibiting custom JSON error objects (e.g. `{ status: "error" }`). Without an explicit anti-pattern example, the LLM pattern-matched against generic Express/Node conventions where developers manually call `res.status(400).json(...)`.

---

## 3. Exact Context Added to Resolve the Violation

To permanently prevent this convention violation, we made two targeted context updates:

### A. System-Level Context Updates ([progress/system-context.md](system-context.md))
1. **Added `SafeErrorEnvelope` TypeScript Interface:**
   ```typescript
   export interface SafeErrorEnvelope {
     error: {
       code: string;       // Machine-readable enum (e.g., 'VALIDATION_ERROR', 'FORBIDDEN')
       message: string;    // Human-readable message
       request_id: string; // Distributed trace ID matching X-Request-Id header (e.g., 'req_...')
     };
   }
   ```
2. **Defined Architectural Responsibility Rule:**
   - *Domain Layer (Controllers & Services):* Must **NEVER** format error response JSON or call `res.status(...).json(...)`. Always throw standard NestJS `HttpException` subclasses.
   - *Serialization Layer (`AllExceptionsFilter`):* Registered globally as `APP_FILTER` in `AppModule`; sole component authorized to format error JSON and attach `request_id`.
3. **Added Concrete INCORRECT vs. CORRECT Code Exemplar:**
   - Explicitly displays the anti-pattern (`res.status(400).json({ status: 'error', ... })`) alongside the canonical pattern (`throw new BadRequestException(...)`).
4. **Added Universal Constraint 6:**
   - *"Zero Ad-Hoc Error Formats: Do NOT construct or return custom error JSON dictionaries. Always throw NestJS HttpException subclasses."*

### B. Task-Specific Context Updates ([progress/context-packages.md](context-packages.md))
1. **Local Context Expansion:**
   - Added [api/src/common/filters/all-exceptions.filter.ts](../api/src/common/filters/all-exceptions.filter.ts) to Task Bundle 2 (`POST /teams`) and Task Bundle 3 (`GET /teams/:id`).
2. **Explicit Prompt Negative Constraints:**
   - Injected into assembled prompts:
     `NEGATIVE CONSTRAINTS: Do NOT manually format or return custom error JSON (e.g. { status: 'error', message: '...' }). Always throw standard NestJS built-in HTTP exceptions. Centralized AllExceptionsFilter automatically serializes them into SafeErrorEnvelope with request_id.`

---

## 4. Before-and-After Comparison

| Dimension | Before (Under-Specified Context) | After (Grounded Context with Guardrails) |
| :--- | :--- | :--- |
| **System Context** | Vague mention of NestJS exceptions and single JSON sample | Exact `SafeErrorEnvelope` interface, error mapping table, and architectural responsibility rule |
| **Task Prompts** | Generic negative constraints (lines $\le 125$, no packages) | Explicit negative constraint forbidding ad-hoc JSON errors and mandating `HttpException` throwing |
| **Exemplars Provided** | Only happy-path controller/service code | Concrete anti-pattern (`res.status(400).json`) vs. canonical pattern (`throw new BadRequestException`) |
| **Agent Mental Model** | Controller catches error and constructs `{ status: 'error' }` | Controller lets exception bubble up to `AllExceptionsFilter` for serialization into `SafeErrorEnvelope` |
| **Client Wire Format** | Inconsistent: `{ status: 'error', message: '...', statusCode: 400 }` | Canonical: `{ error: { code: 'VALIDATION_ERROR', message: '...', request_id: 'req_...' } }` |
| **Observability** | Bypassed; no `request_error` log; no request correlation | Guaranteed `request_error` structured log with latency and request ID correlation |

---

## 5. Source Code Evidence & Grounding

The corrections are directly grounded in the existing repository source code:

1. **Envelope Definition & Catch Decorator:**
   [api/src/common/filters/all-exceptions.filter.ts](../api/src/common/filters/all-exceptions.filter.ts#L36-L52)
   ```typescript
   export interface SafeErrorEnvelope {
     error: {
       code: string;
       message: string;
       request_id: string;
     };
   }
   @Catch()
   export class AllExceptionsFilter implements ExceptionFilter { ... }
   ```

2. **Global Filter Binding via Dependency Injection:**
   [api/src/app.module.ts](../api/src/app.module.ts#L36-L39)
   ```typescript
   providers: [
     {
       provide: APP_FILTER,
       useClass: AllExceptionsFilter,
     },
   ],
   ```

3. **Request ID Correlation:**
   [api/src/common/middleware/request-id.util.ts](../api/src/common/middleware/request-id.util.ts#L45-L50)
   ```typescript
   export function resolveOrCreateRequestId(req: RequestWithContext, res: HttpResponseLike): string {
     if (req.requestId && isValidRequestId(req.requestId)) {
       res.setHeader('X-Request-Id', req.requestId);
       return req.requestId;
     }
     ...
   }
   ```

4. **Service Exception Throwing Convention:**
   [api/src/links/links.service.ts](../api/src/links/links.service.ts#L65-L70)
   ```typescript
   private validateUrlOrThrow(rawUrl: string): void {
     const validation = validateDestinationUrl(rawUrl);
     if (!validation.valid) {
       throw new BadRequestException(validation.message || 'Invalid destination URL');
     }
   }
   ```

---

## 6. Verification & Limitations

- **Context Completeness:** Verified that all 3 context packages in `progress/context-packages.md` include the necessary architectural references, local files, and explicit negative constraints.
- **Diff Bound Compliance:** Verified that all proposed outputs remain strictly within the $\le 150$ lines atomic task sizing rule (Task 1: ~35 lines, Task 2: ~80 lines, Task 3: ~75 lines).
- **Application Code Integrity:** Verified via `git status` that zero application files in `api/src/` or `api/prisma/` have been modified during this context engineering exercise.
- **Verification Discipline:** We do not claim runtime HTTP tests passed for unwritten team endpoints. Rather, we verified the static contract alignment between the prompt instructions, output code, and the codebase's existing exception filter pipeline.

