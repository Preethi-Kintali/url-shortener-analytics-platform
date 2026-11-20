# TICK-02: GET /api/v1/providers — List Seeded Providers with Services

## 1. Title
`TICK-02: GET /api/v1/providers — List Seeded Providers with Featured Services`

---

## 2. Context (Why)
The SkillSwap homepage allows learners to discover mentors across skill categories. This endpoint supplies the frontend card grid with provider profiles, their hourly rate, categories, and featured service offerings so learners can select a mentor to view available booking slots.

---

## 3. Scope (What)
- Implement a single HTTP `GET` endpoint at `/api/v1/providers`.
- Query the `providers` table and join associated records from `services`.
- Return a JSON array of providers, sorted deterministically by `name ASC`.
- Support an optional query parameter `?category=<category_name>` for basic filtering.
- Include structured error handling returning standardized error payloads on internal failures.

---

## 4. Interface Contract (Inputs/Outputs/Data Shapes)

### HTTP Request:
- **Method:** `GET`
- **Route:** `/api/v1/providers`
- **Query Parameters (Optional):**
  - `category` (string, optional): Case-insensitive category filter (e.g., `?category=System%20Design`).

### HTTP Response (200 OK):
```json
{
  "data": [
    {
      "id": "22222222-2222-2222-2222-222222222222",
      "name": "Marcus Vance",
      "headline": "Cloud Architect & Distributed Systems Lead",
      "bio": "12+ years designing resilient distributed systems and mentoring cloud engineers.",
      "category": "System Design",
      "hourly_rate_cents": 6500,
      "avatar_url": "https://assets.skillswap.dev/avatars/marcus.jpg",
      "services": [
        {
          "id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
          "title": "1-on-1 System Architecture Coaching",
          "description": "Deep-dive session reviewing system architecture, scaling bottlenecks, and tradeoffs.",
          "duration_minutes": 60,
          "price_cents": 6500
        }
      ]
    }
  ],
  "meta": {
    "total": 1
  }
}
```

### HTTP Response (500 Internal Server Error):
```json
{
  "error": {
    "code": "DATABASE_ERROR",
    "message": "Failed to retrieve provider directory."
  }
}
```

---

## 5. Acceptance Criteria (Given / When / Then)

### Scenario 1: Fetch All Providers
- **Given** the database has been seeded with 3 providers (TICK-01),
- **When** a client sends a `GET` request to `/api/v1/providers` without query parameters,
- **Then** the server responds with HTTP status `200 OK`,
- **And** the response body contains an array of exactly 3 provider objects,
- **And** each provider object includes an array of `services` containing at least 1 service package.

### Scenario 2: Filter Providers by Category
- **Given** providers exist across categories ("Computer Science", "System Design", "DevOps"),
- **When** a client sends `GET /api/v1/providers?category=System%20Design`,
- **Then** the response status is `200 OK`,
- **And** the `data` array contains only providers whose category equals "System Design" (Marcus Vance),
- **And** `meta.total` equals 1.

### Scenario 3: Filter by Non-Existent Category
- **Given** the seeded database,
- **When** a client sends `GET /api/v1/providers?category=Astronomy`,
- **Then** the response status is `200 OK`,
- **And** the `data` array is empty `[]`,
- **And** `meta.total` equals 0.

---

## 6. Constraints (Rules to Follow)
- Adhere strictly to the project controller/service layering pattern.
- No client-side or server-side caching headers (`Cache-Control: no-store` for now).
- No authentication required (`GET /api/v1/providers` is a public endpoint).
- All response keys must use `snake_case`.

---

## 7. Anti-Scope (What NOT to Build)
- No pagination parameters (`page`, `limit`) — static list only.
- No free-text search index (Elasticsearch, Postgres Full-Text Search).
- No sorting query parameters (`?sort=price_asc`).
- No rating calculations or review counts (ratings are static strings/seed data).
- No provider contact info (email, phone).
