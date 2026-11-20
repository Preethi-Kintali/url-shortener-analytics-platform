# Module 03 – Step 5: BREAK – Design Document Audit

## 1. Missing Structural Section: Alternatives Considered
- **The Defect:** Complete absence of an *Alternatives Considered* section. Jamie jumps directly to Apache Kafka as a foregone conclusion.
- **Engineering Risk:** Kafka introduces massive operational overhead (broker provisioning, cluster coordination, partition rebalancing, and specialized on-call runbooks). By failing to evaluate simpler alternatives (e.g. AWS SQS, RabbitMQ, Redis Streams, or lightweight task queues), the proposal cannot prove that Kafka's operational footprint is warranted for 2,000 events/second.

## 2. Fatal Architectural Contradiction: Single Partition vs. Consumer Scaling
- **The Defect:** Proposing a *single partition* to guarantee event ordering for purchases while claiming consumer lag will be mitigated by *scaling up consumers*.
- **Mechanism of Failure:** In Apache Kafka, a partition within a topic can only be assigned to a single consumer within a consumer group at any given time. Adding additional consumers to a single-partition topic leaves them completely idle. This creates an unfixable throughput bottleneck as purchase transaction volume grows.
- **Architectural Solution:** Partitioning events using a deterministic business key (such as `customer_id` or `order_id`). This preserves per-entity chronological ordering within individual partitions while enabling horizontal scaling across multiple consumers.

## 3. API Boundary Vulnerability & Kafka Reachability
- **The Defect:** Relying on a broker replication factor of 3 as a mitigation for Kafka downtime.
- **Mechanism of Failure:** Replication factor 3 protects committed data against broker hardware loss. It provides zero protection if the Kafka cluster becomes network-partitioned, exhausted, or unreachable from the API web tier during an incoming request.
- **Architectural Solution:**
  - Establishing explicit publisher timeout bounds and asynchronous buffer policies.
  - Implementing a **Transactional Outbox Pattern** in the relational database to ensure zero data loss for critical business transactions (e.g. purchases) if the event broker is temporarily unavailable.
  - Adding bounded exponential backoff retries and explicit client-facing failure semantics.
