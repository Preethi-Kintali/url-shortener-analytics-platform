# Debugging & Incident Response — Product Scenario: linkops

**Session ID**: `nio880GmEu6L7HqkpqO90`  
**Skill**: Debugging & Incident Response (`debugging-incident-response`)  
**Pack**: Launchpad (`spk_debugging_incident_response_launchpad`)  
**Module**: Module 01  
**Step**: SCENARIO PICK (`scenario_pick`)  
**Product Scenario**: `linkops` (URL Shortener Platform)  

---

## 1. System Surface & Service Architecture

The lab vehicle for the entire skill is **linkops**, a high-throughput URL shortener platform with customer-facing redirects, administrative management, and asynchronous analytics processing:

- `POST /links`: Creates shortened links with optional custom slugs and TTL.
- `GET /:shortCode`: Public redirect path resolving short codes to long target URLs and recording click analytics.
- `GET /api/admin/links`: Administrator inspection endpoint for link inventory and traffic reports.
- `DELETE /api/admin/links/:id`: Administrative deletion and instant cache eviction.
- **Background Worker**: Asynchronous message consumer ingesting analytics events from a queue and persisting aggregations to database storage.

---

## 2. Hard Operational Constraints

1. **Redirect Path Availability & Latency**: Redirects (`GET /:shortCode`) must maintain sub-10ms p95 latency and remain fully operational even during background database or worker degradation.
2. **Admin Endpoint Security**: Administrative routes must strictly validate incoming request parameters and reject unauthorized or malformed requests.
3. **Analytics Accuracy Under Concurrency**: Asynchronous click tracking must maintain data integrity and accurate metrics under high concurrent request bursts without lost updates.
4. **Instant Cache Invalidation**: Deletion or updates to links must invalidate the Redis/in-memory cache immediately to prevent stale redirects.
5. **Worker Resource Isolation**: Background queue retries and failed analytics processing must never exhaust connection pools or starve user-facing API threads.

---

## 3. Scenario Selection Confirmation

- **Scenario Key**: `bootcamp.product_scenario = "linkops"`
- **Scope**: Serves as the fixed lab foundation across all 7 modules of the Debugging & Incident Response skill.
