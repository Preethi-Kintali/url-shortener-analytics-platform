# Module 01 – Step 6: FIX – Constructive Code Review Rewrite

## 1. Rewritten Review Artifact

```markdown
# Constructive Code Review: Add user summary generation

## Overall Feedback

Thanks for working on this implementation. The function has a clear purpose, and I like that the logic is self-contained without modifying the original user records. The initial docstring also helps explain what the function does.

I noticed a few areas where we could improve correctness and readability before merging.

## 1. Required Changes (Blocking Bugs)

**Handle division by zero**

Currently, `average_account_age` is calculated using `total_age / cnt`. If there are no active users, `cnt` becomes zero and the function raises a `ZeroDivisionError`.

Could we add a guard condition before performing this calculation? We should also agree on the expected fallback value, such as `0` or `None`, when there are no active users.

Please include tests for an empty user list and a list containing only inactive users.

**Correct the average age calculation**

The loop currently adds the account age of both active and inactive users to `total_age`, but the average is divided only by the active user count.

Could we confirm whether the average should include all users or only active users? If it should include all users, we should divide by `total_users`. If it should include only active users, we should maintain a separate total for active users.

## 2. Suggestions (Readability and Maintainability)

**Use descriptive variable names**

Could we replace `d`, `cnt`, and `cnt2` with names like `summary`, `active_count`, and `inactive_count`? This would make the logic easier to understand without requiring readers to remember what each variable represents.

**Simplify list iteration**

Instead of using `for i in range(len(users))`, could we iterate directly using `for user in users`? This is simpler and more readable in Python.

**Reduce nested conditional statements**

The health classification contains multiple levels of nested conditions. Could we move this logic into a separate helper function or use early returns? This would make the conditions easier to follow and maintain.

**Consider a structured return type**

Using a dictionary is perfectly reasonable for this implementation. If the response structure grows or is shared across multiple modules, we could consider a `TypedDict` or dataclass to make the expected fields clearer. This is an optional suggestion, not a blocker.

## Final Recommendation

**Request Changes**

The implementation is a good starting point. However, the division-by-zero issue and the average-age calculation need clarification and correction before merging. The readability improvements can then be addressed to make the code easier to maintain.

Thanks for the work on this!
```

---

## 2. Reflection & Impact Analysis

### 1. PR Merge Velocity
- **Constructive Review:** Clearly partitions critical merge-blocking bugs from non-blocking readability suggestions, and pairs every critique with concrete, drop-in solutions. The author immediately understands what changes must be made and can push fixes within hours.
- **Hostile Review:** Triggers cognitive overload, defensiveness, and tangential arguments about subjective preferences (e.g. dictionaries vs dataclasses) while the critical division-by-zero bug remains unaddressed, stalling the PR for days.

### 2. Psychological Safety & Engineering Culture
- **Constructive Review:** Acknowledges the author's positive contributions upfront, explains the *why* behind technical issues, and frames feedback collaboratively. This fosters psychological safety, encouraging engineers to submit early drafts and iterate with confidence.
- **Hostile Review:** Leaves developers demoralized, anxious, and hesitant, leading to delayed submissions, siloed work, and defensive over-engineering.
