# Module 05 — REFLECT: Stakeholder Communication

## 1. Defending My Medium Choice to Leadership

I would still choose a written memo because executive decisions need more than a presentation. They need a clear record of the problem, business impact, risks, alternatives, and decisions required.

Marcus's original email shows that having headings and bullet points does not automatically make communication effective. The problem was that he organized the information around engineering implementation instead of the business decision.

If a director asked why I did not choose a slide deck, I would explain that a written memo allows stakeholders to review the proposal at their own pace, examine the details, forward it to other decision-makers, and refer back to the agreed decisions during implementation.

A presentation can support the discussion, but the written memo should remain the primary source of truth.

## 2. The Critical Difference: Simplifying vs. Translating

While rewriting the proposal, I made sure not to remove important technical facts just to make the document shorter.

For example, I preserved the 42.5 GB additional memory requirement across 340 pods instead of simply saying that the new system needs more resources. I also retained the 12,000 requests-per-second gateway capacity, the 11,400 requests-per-second Black Friday peak, and the p99 latency increase to 1.8 seconds.

Instead of explaining every internal technology in detail, I connected these facts to their business consequences: checkout timeouts, insufficient capacity during traffic spikes, and potential lost revenue.

I also preserved the performance acceptance criteria of 24,000 requests per second at p95 below 150 ms and the fallback to the existing Kong setup.

This taught me that good communication does not hide technical complexity. It explains why that complexity matters to the people making the decision.

## 3. Career Impact of Stakeholder Communication

I believe stakeholder communication is a fundamental engineering leadership skill because engineers do not work in isolation. Technical decisions affect product releases, customer experience, reliability, budgets, and business priorities.

An engineer may identify a serious infrastructure risk, but if they cannot explain its business impact, leadership may not understand why it deserves immediate attention or additional resources.

Good communication helps engineers build trust, justify technical investments, coordinate teams, and influence roadmap decisions. It also helps leadership make informed tradeoffs instead of making decisions based on incomplete information.

As I grow as an engineer, I want to develop the ability to explain not only how a system works, but also why a technical decision matters to the business and what action should follow.

## Final Reflection

My biggest takeaway from this module is that effective technical communication is not about using fewer technical words. It is about preserving the important facts, connecting them to business outcomes, and making the required decision clear.

A good engineering proposal should answer three questions: What is the business problem? What happens if we do nothing? What decision do we need from leadership?
