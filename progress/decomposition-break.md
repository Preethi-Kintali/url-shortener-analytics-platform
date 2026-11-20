# Module 02 BREAK: The Conflicting Assumption Analysis

## 1. Scenario Diagnosis: The Broken Boundary Between Task 1 and Task 2

In this decomposition failure scenario, two independently prompted tasks fail to integrate at runtime:

### What Task 1 Built:
- An isolated `teams` table with columns: `id`, `name`, `owner_id`, `created_at`, `updated_at`.
- Mental model: A single-owner 1:1 resource model.

### What Task 2 Generated:
- Controller and service logic for team operations that executes:
  ```typescript
  await this.prisma.teamMember.create({
    data: {
      teamId: team.id,
      userId: userId,
      role: 'OWNER'
    }
  });
  ```
- Or a query checking:
  ```typescript
  const member = await this.prisma.teamMember.findUnique({
    where: { teamId_userId: { teamId, userId } }
  });
  ```

### The Concrete Failure:
1. **Compilation Failure (`tsc`):**
   ```text
   Property 'teamMember' does not exist on type 'PrismaClient'.
   ```
2. **Runtime Database Failure (PostgreSQL):**
   ```text
   PrismaClientKnownRequestError:
   Invalid `prisma.teamMember.create()` invocation:
   The table `public.team_members` does not exist in the current database.
   ```

---

## 2. Root Cause: Decomposition Bug vs. AI Hallucination

This failure is **not** an AI hallucination bug. It is a **systemic task decomposition and context boundary bug**:

| Investigation Question | Diagnostic Finding |
|---|---|
| **Where does Task 2 reference missing entities?** | Task 2 references the Prisma delegate `prisma.teamMember` and database table `team_members` with column `role`. Task 1 only provisioned the `teams` table. |
| **What did Task 2 assume?** | Task 2 assumed that a relational N:M join table (`team_members`) with fine-grained role enums (`OWNER`, `ADMIN`, `MEMBER`) was already provisioned in the database schema. |
| **Why did the prompt fail to provide context?** | Task 2's prompt relied on the human engineer's *future mental plan* rather than the *actual schema artifact* produced by Task 1. Task 1 was under-scoped relative to Task 2's dependencies. |
| **Data model vs. API contract conflict?** | **Both:**<br>1. *Data Model Conflict:* Task 1 stored ownership as a scalar `owner_id` on `teams`; Task 2 modeled ownership as an initial row with `role: OWNER` in `team_members`.<br>2. *API Contract Conflict:* The response shape of `POST /teams` was expected to include member metadata, which could not be loaded. |

---

## 3. Real-World Analogy: The Door and the Frame
As the prompt notes, this is identical to two construction crews working from different, uncoordinated drawings:
- Crew A frames a 32-inch rough opening.
- Crew B manufactures a 36-inch pre-hung door.
- Both crews followed their respective work orders flawlessly, but because no explicit **interface contract** bound them, the assembled product is completely broken.

---

## 4. Resolution Plan for Step 6 (FIX)
To eliminate conflicting assumptions between dependent tasks:
1. **Establish an Explicit Interface Contract:** Define the exact TypeScript interface and Prisma model signature for `Team` and `TeamMember` upfront.
2. **Align Task Scope:**
   - Either expand Task 1 to include both `Team` and `TeamMember` models in a single atomic migration (as designed in our Task Tree), OR
   - Insert an explicit intermediate schema migration task before Task 2 that creates `TeamMember`.
3. **Context Injection:** When prompting Task 2, provide the exact generated `schema.prisma` and generated Prisma Client types as explicit input context, forbidding references to non-existent delegates.

