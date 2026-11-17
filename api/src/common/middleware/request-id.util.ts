import { AsyncLocalStorage } from 'async_hooks';
import * as crypto from 'crypto';

// Strict allowlist prevents log/header injection via untrusted X-Request-Id values.
const VALID_REQUEST_ID_REGEX = /^[A-Za-z0-9._-]{8,64}$/;
const requestIdStorage = new AsyncLocalStorage<string>();

export function runWithRequestId<T>(requestId: string, fn: () => T): T {
  return requestIdStorage.run(requestId, fn);
}

export function getCurrentRequestId(): string | undefined {
  return requestIdStorage.getStore();
}

export interface HttpRequestLike {
  method: string;
  url?: string;
  originalUrl?: string;
  headers?: Record<string, string | string[] | undefined>;
  requestId?: string;
  requestStartNs?: bigint;
  requestLoggerAttached?: boolean;
}

export interface HttpResponseLike {
  statusCode: number;
  locals?: Record<string, unknown>;
  setHeader(name: string, value: string): void;
  status(code: number): HttpResponseLike;
  json(body: unknown): void;
  on(event: 'finish', listener: () => void): void;
}

export type RequestWithContext = HttpRequestLike;

export function generateRequestId(): string {
  return `req_${crypto.randomBytes(12).toString('hex')}`;
}

export function isValidRequestId(candidate: unknown): candidate is string {
  return typeof candidate === 'string' && VALID_REQUEST_ID_REGEX.test(candidate);
}

export function resolveOrCreateRequestId(req: RequestWithContext, res: HttpResponseLike): string {
  if (req.requestId && isValidRequestId(req.requestId)) {
    res.setHeader('X-Request-Id', req.requestId);
    return req.requestId;
  }

  const incoming = req.headers?.['x-request-id'];
  const requestId = isValidRequestId(incoming) ? incoming : generateRequestId();

  req.requestId = requestId;
  if (!req.requestStartNs) {
    req.requestStartNs = process.hrtime.bigint();
  }
  res.setHeader('X-Request-Id', requestId);
  return requestId;
}

export function computeLatencyMs(startNs?: bigint): number {
  if (!startNs) {
    return 0;
  }
  const elapsedNs = process.hrtime.bigint() - startNs;
  return Math.round((Number(elapsedNs) / 1_000_000) * 100) / 100;
}
