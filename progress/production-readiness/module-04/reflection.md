# Module 04: Observability - Reflection

## 1. Decisions in Practice
I would keep both hybrid logging and pull-based Prometheus for long-running containerized services. Hybrid logging provides readable logs during development and structured logs in production, while Prometheus provides reliable metrics collection.

If the service moves to short-lived serverless functions like AWS Lambda, I would consider push-based telemetry using OpenTelemetry or a cloud monitoring collector because short-lived instances may finish execution before the next Prometheus scrape.

## 2. Alert Quality vs. Blind Spots
Both are dangerous, but too few alerts can allow serious production issues to continue unnoticed. Too many alerts create alert fatigue, causing engineers to ignore important notifications.

Teams should define alerts based on service-level objectives, error rates, latency, and availability. They should use appropriate thresholds, evaluation windows, and severity levels so that alerts represent actionable problems rather than temporary fluctuations.

## 3. If You Could Only Have One
I would choose metrics because they provide a high-level view of the application's health and performance. Metrics help identify unusual traffic, increased latency, error rates, and resource usage. Although logs are important for investigating specific failures, metrics help detect problems early and understand their overall impact.
