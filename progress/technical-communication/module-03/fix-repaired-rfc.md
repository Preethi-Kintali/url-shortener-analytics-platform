# Module 03 – Step 6: FIX – Repaired Design Document Sections

## 1. Alternatives Considered
- **Alternative A: Managed Cloud Queue (AWS SQS / Google Cloud Pub/Sub)**
  - *Definition:* Fully managed cloud message queuing service.
  - *Advantages:* Zero infrastructure operations, automatic scaling, built-in dead-letter queues and retry mechanisms, pay-per-use pricing.
  - *Tradeoff / Why not selected:* Kafka provides strict partition-level ordering, immutable log retention, and multi-consumer group event replay, which are critical if multiple downstream systems consume the event stream or historical replays are required. Total cost of ownership requires formal comparison.
- **Alternative B: Redis Streams**
  - *Definition:* In-memory append-only log with consumer group abstractions.
  - *Advantages:* Integrates into existing Redis infrastructure, low latency, lightweight operations.
  - *Tradeoff / Why not selected:* Memory footprint scales linearly with retention; lacks native multi-datacenter replication and long-term disk-backed stream durability compared to Kafka.
- **Alternative C: Scheduled Batch Ingestion**
  - *Definition:* Storing raw events and processing via periodic cron jobs.
  - *Advantages:* Maximizes database bulk insert throughput and simplifies pipeline architecture.
  - *Tradeoff / Why not selected:* Fails near-real-time business requirements for immediate purchase analytics and activity triggers.

## 2. Open Questions: Analytics Database Capacity
- **Unvalidated Benchmark Assumptions:** The claimed 10,000 writes/sec benchmark failed to account for production index write amplification, full schema row width, concurrent analytical read/reporting queries, replication overhead, and burst traffic.
- **Validation Plan:**
  - *Owners:* Backend Database Engineer + Infrastructure Engineer.
  - *Timeline:* Weeks 1–2 (prior to consumer development and production cutover).
  - *Procedure:* Staging load test with representative schemas and indexes; sustained 2,000 writes/sec and burst 5,000 writes/sec under concurrent analytical read loads.
  - *Acceptance Criteria:* Zero data loss, p95 write latency $< 100\text{ms}$, CPU/memory headroom $> 30\%$.
- **Fallback Architecture:** Introduce consumer-level batching and bulk inserts; if throughput targets fail, evaluate time-series databases (e.g. ClickHouse) or buffer layers.

## 3. Concrete, Actionable Risk Mitigations
- **Kafka Broker Outages:**
  - *Settings:* `acks=all`, `min.insync.replicas=2`, producer idempotence enabled.
  - *API Resiliency:* Implementation of the **Transactional Outbox Pattern** ensures purchase events are committed transactionally to the database before asynchronous dispatch, preventing data loss if Kafka is unreachable.
  - *Playbook:* 5-minute initial triage for under-replicated partitions; 15-minute escalation to Infrastructure Lead.
- **Consumer Lag:**
  - *Threshold:* Alert fires if consumer lag exceeds 10,000 messages for 5 consecutive minutes.
  - *Action:* On-call engineer identifies bottleneck (consumer CPU vs DB write contention); scales consumers up to partition limit or enables micro-batching.
- **Purchase Event Ordering vs. Parallelism:**
  - *Resolution:* Replaced the single-partition bottleneck with deterministic key-based partitioning (`customer_id` or `order_id`).
  - *Outcome:* Guarantees strict chronological ordering for individual customers/orders while enabling horizontal consumer scaling across all partitions.
- **Risk of Doing Nothing:**
  - Quantifies continuous 150–300ms latency tax on all API endpoints, escalating database contention, and inability to support traffic growth.

## 4. Final Recommendation
- **Verdict:** **Conditional Approval for Implementation Planning** (pending database load test results, outbox pattern validation, and key-based partitioning confirmation).
