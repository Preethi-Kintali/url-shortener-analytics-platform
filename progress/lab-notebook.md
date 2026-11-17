# Module 10: Final Demo Script Execution Log
**Executed at:** 2026-11-13T14:41:49.873Z
**Environment:** Docker container (`bootcamp-api:latest`) on port 3128, connected to `upsk_sdf_test` and Redis DB 1.

## 1) Health Check (Liveness)
```powershell
> curl.exe -fsS http://localhost:3128/health
```
**Output:**
```text
{"ok":true}
```

## 1) Readiness Check
```powershell
> curl.exe -fsS http://localhost:3128/ready
```
**Output:**
```text
{"ok":true,"status":"ready","db":"ok","redis":"ok"}
```

## Auth Login (Alice)
```powershell
> curl.exe -s -X POST http://localhost:3128/auth/login -H "Content-Type: application/json" -d '{"email":"alice@example.com","password":"<TEST_PASSWORD>"}'
```
**Output:**
```text
{"access_token":"<JWT_BEARER_TOKEN>","token_type":"Bearer","expires_in":900,"principal_id":"principal_a"}
```

## 2a) Create Link Without Auth (401 Expected)
```powershell
> curl.exe -i http://localhost:3128/links
```
**Output:**
```text
HTTP/1.1 401 Unauthorized
X-Powered-By: Express
X-Request-Id: req_f9421d84b75080cc0909eca5
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 59
X-RateLimit-Reset: 60
Content-Type: application/json; charset=utf-8
Content-Length: 122
ETag: W/"7a-lwh+TF/KKdqpz1ozexEbrT9jS3U"
Date: Fri, 13 Nov 2026 14:41:50 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"error":{"code":"UNAUTHORIZED","message":"Authorization header is required","request_id":"req_f9421d84b75080cc0909eca5"}}
```

## 2b) Create Link With Auth (201 Expected)
```powershell
> curl.exe -i -H "Authorization: Bearer <TOKEN>" -H "Content-Type: application/json" -d '{"long_url":"https://example.com/demo-test-module-10"}' http://localhost:3128/links
```
**Output:**
```text
HTTP/1.1 201 Created
X-Powered-By: Express
X-Request-Id: req_278fa51e45bc18e5cb57f68d
X-RateLimit-Limit: 30
X-RateLimit-Remaining: 29
X-RateLimit-Reset: 60
Content-Type: application/json; charset=utf-8
Content-Length: 238
ETag: W/"ee-/mJpx4qYXWYKzFAr9H6czg84ifs"
Date: Fri, 13 Nov 2026 14:41:50 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"id":"0e67e72d-3ee5-46c4-b06b-b1d40d421995","code":"WxI9M2K","short_url":"http://localhost:3000/r/WxI9M2K","long_url":"https://example.com/demo-test-module-10","tags":[],"created_at":"2026-11-13T14:41:50.501Z","created_by":"principal_a"}
```

## 3) Public Redirect 1 (/r/<CODE>)
```powershell
> curl.exe -i http://localhost:3128/r/WxI9M2K
```
**Output:**
```text
HTTP/1.1 302 Found
X-Powered-By: Express
X-Request-Id: req_dc681b689c0cad9bded7dc27
X-RateLimit-Limit: 120
X-RateLimit-Remaining: 119
X-RateLimit-Reset: 60
Location: https://example.com/demo-test-module-10
Vary: Accept
Content-Type: text/plain; charset=utf-8
Content-Length: 61
Date: Fri, 13 Nov 2026 14:41:50 GMT
Connection: keep-alive
Keep-Alive: timeout=5

Found. Redirecting to https://example.com/demo-test-module-10
```

## 3) Public Redirect 2 (/r/<CODE>)
```powershell
> curl.exe -i http://localhost:3128/r/WxI9M2K
```
**Output:**
```text
HTTP/1.1 302 Found
X-Powered-By: Express
X-Request-Id: req_ca800ac369ed72548980f4f3
X-RateLimit-Limit: 120
X-RateLimit-Remaining: 118
X-RateLimit-Reset: 60
Location: https://example.com/demo-test-module-10
Vary: Accept
Content-Type: text/plain; charset=utf-8
Content-Length: 61
Date: Fri, 13 Nov 2026 14:41:50 GMT
Connection: keep-alive
Keep-Alive: timeout=5

Found. Redirecting to https://example.com/demo-test-module-10
```

## 4) Analytics Updated (Protected)
```powershell
> curl.exe -i -H "Authorization: Bearer <TOKEN>" "http://localhost:3128/links/0e67e72d-3ee5-46c4-b06b-b1d40d421995/analytics?from=2000-01-01&to=2100-01-01"
```
**Output:**
```text
HTTP/1.1 200 OK
X-Powered-By: Express
X-Request-Id: req_7d7db3eb02840b2a7b931fe4
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 59
X-RateLimit-Reset: 60
Content-Type: application/json; charset=utf-8
Content-Length: 195
ETag: W/"c3-/6QB86ABeMojpwv/zDOHWJjdGWw"
Date: Fri, 13 Nov 2026 14:41:52 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"link_id":"0e67e72d-3ee5-46c4-b06b-b1d40d421995","code":"WxI9M2K","from":"2000-01-01T00:00:00.000Z","to":"2100-01-01T23:59:59.999Z","total_clicks":2,"last_clicked_at":"2026-11-13T14:41:50.719Z"}
```

## 5a) Update Link (Protected PATCH)
```powershell
> curl.exe -i -X PATCH "http://localhost:3128/links/0e67e72d-3ee5-46c4-b06b-b1d40d421995" -H "Authorization: Bearer <TOKEN>" -H "Content-Type: application/json" -d '{"long_url":"https://example.org/demo-test-updated"}'
```
**Output:**
```text
HTTP/1.1 200 OK
X-Powered-By: Express
X-Request-Id: req_830a6385d20d787d5be3f8b9
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 59
X-RateLimit-Reset: 60
Content-Type: application/json; charset=utf-8
Content-Length: 236
ETag: W/"ec-1w0HRiSJ7bW/7mmXOv7lM3g7+HA"
Date: Fri, 13 Nov 2026 14:41:52 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"id":"0e67e72d-3ee5-46c4-b06b-b1d40d421995","code":"WxI9M2K","short_url":"http://localhost:3000/r/WxI9M2K","long_url":"https://example.org/demo-test-updated","tags":[],"created_at":"2026-11-13T14:41:50.501Z","created_by":"principal_a"}
```

## 5b) Public Redirect Post-Update (Cache Invalidation Proof)
```powershell
> curl.exe -i http://localhost:3128/r/WxI9M2K
```
**Output:**
```text
HTTP/1.1 302 Found
X-Powered-By: Express
X-Request-Id: req_ff7a30f4e2a4b9b97a401675
X-RateLimit-Limit: 120
X-RateLimit-Remaining: 117
X-RateLimit-Reset: 58
Location: https://example.org/demo-test-updated
Vary: Accept
Content-Type: text/plain; charset=utf-8
Content-Length: 59
Date: Fri, 13 Nov 2026 14:41:53 GMT
Connection: keep-alive
Keep-Alive: timeout=5

Found. Redirecting to https://example.org/demo-test-updated
```

## 6) Search + Pagination (Protected)
```powershell
> curl.exe -i -H "Authorization: Bearer <TOKEN>" "http://localhost:3128/links/search?q=demo-test&page=1&page_size=10"
```
**Output:**
```text
HTTP/1.1 200 OK
X-Powered-By: Express
X-Request-Id: req_d12f69fee1cbf5ca7a087ed6
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 59
X-RateLimit-Reset: 60
Content-Type: application/json; charset=utf-8
Content-Length: 296
ETag: W/"128-8I9QTmZpn+qLHgips6LiZ9x7uWw"
Date: Fri, 13 Nov 2026 14:41:53 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"data":[{"id":"0e67e72d-3ee5-46c4-b06b-b1d40d421995","code":"WxI9M2K","short_url":"http://localhost:3000/r/WxI9M2K","long_url":"https://example.org/demo-test-updated","tags":[],"created_at":"2026-11-13T14:41:50.501Z","created_by":"principal_a"}],"pagination":{"page":1,"page_size":10,"total":1}}
```

## 7) Graceful Shutdown
```powershell
> docker stop bootcamp-api-demo
```
**Stop Duration:** 766ms | **Exit Code:** 0

**Container Logs:**
```text
{"timestamp":"2026-11-13T14:41:49.312Z","level":"info","context":"AnalyticsQueueService","event":"analytics_queue_redis_ready","status":"ok"}
{"timestamp":"2026-11-13T14:41:49.661Z","level":"info","context":"PrismaService","event":"db_connected","status":"ok"}
{"timestamp":"2026-11-13T14:41:49.684Z","level":"info","context":"RedisCacheService","event":"redis_connected","status":"ok"}
{"timestamp":"2026-11-13T14:41:49.693Z","level":"info","context":"NestFactory","message":"Starting Nest application..."}
{"timestamp":"2026-11-13T14:41:49.694Z","level":"info","context":"InstanceLoader","message":"LoggingModule dependencies initialized"}
{"timestamp":"2026-11-13T14:41:49.694Z","level":"info","context":"InstanceLoader","message":"ThrottlerModule dependencies initialized"}
{"timestamp":"2026-11-13T14:41:49.694Z","level":"info","context":"InstanceLoader","message":"JwtModule dependencies initialized"}
{"timestamp":"2026-11-13T14:41:49.694Z","level":"info","context":"InstanceLoader","message":"CacheModule dependencies initialized"}
{"timestamp":"2026-11-13T14:41:49.694Z","level":"info","context":"InstanceLoader","message":"PrismaModule dependencies initialized"}
{"timestamp":"2026-11-13T14:41:49.694Z","level":"info","context":"InstanceLoader","message":"AppModule dependencies initialized"}
{"timestamp":"2026-11-13T14:41:49.695Z","level":"info","context":"InstanceLoader","message":"HealthModule dependencies initialized"}
{"timestamp":"2026-11-13T14:41:49.695Z","level":"info","context":"InstanceLoader","message":"AnalyticsModule dependencies initialized"}
{"timestamp":"2026-11-13T14:41:49.695Z","level":"info","context":"InstanceLoader","message":"AuthModule dependencies initialized"}
{"timestamp":"2026-11-13T14:41:49.695Z","level":"info","context":"InstanceLoader","message":"LinksModule dependencies initialized"}
{"timestamp":"2026-11-13T14:41:49.695Z","level":"info","context":"RoutesResolver","message":"HealthController {/}:"}
{"timestamp":"2026-11-13T14:41:49.695Z","level":"info","context":"RouterExplorer","message":"Mapped {/health, GET} route"}
{"timestamp":"2026-11-13T14:41:49.695Z","level":"info","context":"RouterExplorer","message":"Mapped {/ready, GET} route"}
{"timestamp":"2026-11-13T14:41:49.695Z","level":"info","context":"RouterExplorer","message":"Mapped {/health/ready, GET} route"}
{"timestamp":"2026-11-13T14:41:49.695Z","level":"info","context":"RoutesResolver","message":"AuthController {/auth}:"}
{"timestamp":"2026-11-13T14:41:49.695Z","level":"info","context":"RouterExplorer","message":"Mapped {/auth/login, POST} route"}
{"timestamp":"2026-11-13T14:41:49.695Z","level":"info","context":"RoutesResolver","message":"LinksController {/links}:"}
{"timestamp":"2026-11-13T14:41:49.696Z","level":"info","context":"RouterExplorer","message":"Mapped {/links, POST} route"}
{"timestamp":"2026-11-13T14:41:49.696Z","level":"info","context":"RouterExplorer","message":"Mapped {/links, GET} route"}
{"timestamp":"2026-11-13T14:41:49.696Z","level":"info","context":"RouterExplorer","message":"Mapped {/links/search, GET} route"}
{"timestamp":"2026-11-13T14:41:49.696Z","level":"info","context":"RouterExplorer","message":"Mapped {/links/:id/analytics, GET} route"}
{"timestamp":"2026-11-13T14:41:49.696Z","level":"info","context":"RouterExplorer","message":"Mapped {/links/:id, GET} route"}
{"timestamp":"2026-11-13T14:41:49.696Z","level":"info","context":"RouterExplorer","message":"Mapped {/links/:id, PATCH} route"}
{"timestamp":"2026-11-13T14:41:49.696Z","level":"info","context":"RouterExplorer","message":"Mapped {/links/:id, DELETE} route"}
{"timestamp":"2026-11-13T14:41:49.696Z","level":"info","context":"RoutesResolver","message":"RedirectController {/r}:"}
{"timestamp":"2026-11-13T14:41:49.697Z","level":"info","context":"RouterExplorer","message":"Mapped {/r/:code, GET} route"}
{"timestamp":"2026-11-13T14:41:49.697Z","level":"info","context":"NestApplication","message":"Nest application successfully started"}
{"timestamp":"2026-11-13T14:41:49.698Z","level":"info","context":"Bootstrap","event":"server_started","port":3000,"host":"[REDACTED_IP]"}
{"timestamp":"2026-11-13T14:41:49.864Z","level":"info","context":"HTTP","event":"http_request","request_id":"req_67f5116fc26122302e230281","method":"GET","route":"/ready","status_code":200,"latency_ms":33.34}
{"timestamp":"2026-11-13T14:41:49.930Z","level":"info","context":"HTTP","event":"http_request","request_id":"req_b1ae97524ffe3f2347be9343","method":"GET","route":"/health","status_code":200,"latency_ms":2.22}
{"timestamp":"2026-11-13T14:41:49.999Z","level":"info","context":"HTTP","event":"http_request","request_id":"req_c0494c52db29b0bed7f36dcb","method":"GET","route":"/ready","status_code":200,"latency_ms":11.13}
{"timestamp":"2026-11-13T14:41:50.291Z","level":"info","context":"HTTP","event":"http_request","request_id":"req_8d4bbe6614318f13e353f7ee","method":"POST","route":"/auth/login","status_code":200,"latency_ms":195.54}
{"timestamp":"2026-11-13T14:41:50.348Z","level":"warn","context":"ExceptionsFilter","event":"request_error","request_id":"req_f9421d84b75080cc0909eca5","method":"GET","route":"/links","status_code":401,"latency_ms":4.62,"error_code":"UNAUTHORIZED","error_name":"UnauthorizedException","error_message":"Authorization header is required"}
{"timestamp":"2026-11-13T14:41:50.350Z","level":"warn","context":"HTTP","event":"http_request","request_id":"req_f9421d84b75080cc0909eca5","method":"GET","route":"/links","status_code":401,"latency_ms":6.35,"error_code":"UNAUTHORIZED"}
{"timestamp":"2026-11-13T14:41:50.524Z","level":"info","context":"HTTP","event":"http_request","request_id":"req_278fa51e45bc18e5cb57f68d","method":"POST","route":"/links","status_code":201,"latency_ms":95.26}
{"timestamp":"2026-11-13T14:41:50.605Z","level":"info","context":"RedisCacheService","event":"cache_miss","layer":"redis","code":"WxI9M2K","request_id":"req_dc681b689c0cad9bded7dc27"}
{"timestamp":"2026-11-13T14:41:50.626Z","level":"info","context":"RedisCacheService","event":"cache_populated","layer":"redis","code":"WxI9M2K","ttl_seconds":295,"request_id":"req_dc681b689c0cad9bded7dc27"}
{"timestamp":"2026-11-13T14:41:50.659Z","level":"info","context":"AnalyticsQueueService","event":"click_event_enqueued","layer":"bullmq","code":"WxI9M2K","idempotency_key":"54487306-32f8-42c5-be78-dd6868f2f203","request_id":"req_dc681b689c0cad9bded7dc27"}
{"timestamp":"2026-11-13T14:41:50.669Z","level":"info","context":"HTTP","event":"http_request","request_id":"req_dc681b689c0cad9bded7dc27","method":"GET","route":"/r/WxI9M2K","status_code":302,"latency_ms":76.13}
{"timestamp":"2026-11-13T14:41:50.719Z","level":"info","context":"RedisCacheService","event":"cache_hit","layer":"redis","code":"WxI9M2K","request_id":"req_ca800ac369ed72548980f4f3"}
{"timestamp":"2026-11-13T14:41:50.727Z","level":"info","context":"AnalyticsQueueService","event":"click_event_enqueued","layer":"bullmq","code":"WxI9M2K","idempotency_key":"c070c35c-5f8e-4d07-8578-b0451412b7fc","request_id":"req_ca800ac369ed72548980f4f3"}
{"timestamp":"2026-11-13T14:41:50.729Z","level":"info","context":"HTTP","event":"http_request","request_id":"req_ca800ac369ed72548980f4f3","method":"GET","route":"/r/WxI9M2K","status_code":302,"latency_ms":16.41}
{"timestamp":"2026-11-13T14:41:52.865Z","level":"info","context":"HTTP","event":"http_request","request_id":"req_7d7db3eb02840b2a7b931fe4","method":"GET","route":"/links/0e67e72d-3ee5-46c4-b06b-b1d40d421995/analytics","status_code":200,"latency_ms":44.29}
{"timestamp":"2026-11-13T14:41:52.961Z","level":"info","context":"RedisCacheService","event":"cache_invalidated","layer":"redis","code":"WxI9M2K","request_id":"req_830a6385d20d787d5be3f8b9"}
{"timestamp":"2026-11-13T14:41:52.962Z","level":"info","context":"HTTP","event":"http_request","request_id":"req_830a6385d20d787d5be3f8b9","method":"PATCH","route":"/links/0e67e72d-3ee5-46c4-b06b-b1d40d421995","status_code":200,"latency_ms":36.41}
{"timestamp":"2026-11-13T14:41:53.008Z","level":"info","context":"RedisCacheService","event":"cache_miss","layer":"redis","code":"WxI9M2K","request_id":"req_ff7a30f4e2a4b9b97a401675"}
{"timestamp":"2026-11-13T14:41:53.021Z","level":"info","context":"RedisCacheService","event":"cache_populated","layer":"redis","code":"WxI9M2K","ttl_seconds":292,"request_id":"req_ff7a30f4e2a4b9b97a401675"}
{"timestamp":"2026-11-13T14:41:53.033Z","level":"info","context":"AnalyticsQueueService","event":"click_event_enqueued","layer":"bullmq","code":"WxI9M2K","idempotency_key":"3d012c42-790d-486f-b486-15878d7fba45","request_id":"req_ff7a30f4e2a4b9b97a401675"}
{"timestamp":"2026-11-13T14:41:53.036Z","level":"info","context":"HTTP","event":"http_request","request_id":"req_ff7a30f4e2a4b9b97a401675","method":"GET","route":"/r/WxI9M2K","status_code":302,"latency_ms":36.84}
{"timestamp":"2026-11-13T14:41:53.198Z","level":"info","context":"LinksService","event":"links_searched","has_q":true,"has_tag":false,"page":1,"page_size":10,"returned":1,"total":1,"request_id":"req_d12f69fee1cbf5ca7a087ed6"}
{"timestamp":"2026-11-13T14:41:53.200Z","level":"info","context":"HTTP","event":"http_request","request_id":"req_d12f69fee1cbf5ca7a087ed6","method":"GET","route":"/links/search","status_code":200,"latency_ms":108.71}

```
