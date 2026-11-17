export const ANALYTICS_QUEUE_NAME = 'analytics-clicks';
export const RECORD_CLICK_JOB_NAME = 'record-click';
export const PURGE_EXPIRED_CLICKS_JOB_NAME = 'purge-expired-clicks';

export const CLICK_JOB_ATTEMPTS = 5;
export const CLICK_JOB_BACKOFF_MS = 500;
export const QUEUE_ENQUEUE_TIMEOUT_MS = 250;
export const RETENTION_REPEAT_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface ClickEventJobPayload {
  eventId: string;
  code: string;
  linkId?: string;
  clickedAt: string;
  userAgent: string;
  referrer: string;
  ipHash: string;
  requestId?: string;
}

