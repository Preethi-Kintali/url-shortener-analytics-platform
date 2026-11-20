/**
 * break-repro-duplicate-analytics.js
 *
 * Reproduces the Module 06 BREAK defect:
 * Duplicate analytics processing when a link is deleted and re-created with the same short code.
 */

const assert = require('assert');

// In-memory simulation of Redirect Cache, Queue, and Analytics DB
const redirectCache = new Map();
const analyticsQueue = [];
const analyticsDb = []; // records { id, linkId, code, eventId, processedAt }

// 1. User creates original link "launch24" (ID: link-uuid-1)
let linkDb = {
  'launch24': { id: 'link-uuid-1', code: 'launch24', target: 'https://example.com/v1', deleted: false }
};

console.log('--- Step 1: Initial Link Creation and Redirect Clicks ---');
function clickLink(code) {
  const link = linkDb[code];
  if (!link || link.deleted) {
    return { status: 404 };
  }

  // Enqueue analytics event
  const eventId = `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  analyticsQueue.push({ eventId, code, linkId: link.id });
  return { status: 302, target: link.target };
}

// User clicks link-1 twice
clickLink('launch24');
clickLink('launch24');
assert.strictEqual(analyticsQueue.length, 2);
console.log(`Enqueued ${analyticsQueue.length} click events for link-uuid-1.`);

// 2. User deletes link-1. Cache invalidation runs!
console.log('\n--- Step 2: Delete Link & Cache Invalidation ---');
linkDb['launch24'].deleted = true;
redirectCache.delete('redirect:launch24'); // Bug #9 fix: cache purged!

// 3. User immediately re-creates a link with the SAME short code "launch24" (ID: link-uuid-2)
console.log('\n--- Step 3: Re-create Link with Same Short Code ---');
linkDb['launch24'] = { id: 'link-uuid-2', code: 'launch24', target: 'https://example.com/v2', deleted: false };

// User clicks new link-2 once
clickLink('launch24');
console.log(`Total jobs in queue: ${analyticsQueue.length} (2 from old link, 1 from new link).`);

// 4. Analytics Worker processes jobs.
// Notice the defect: If worker resolves linkId by code at execution time rather than using immutable linkId from event payload,
// all 3 events bind to link-uuid-2, causing click counts for the new link to double/triple!
console.log('\n--- Step 4: Worker Processing Defect Demonstration ---');
for (const job of analyticsQueue) {
  // Vulnerable worker lookup: queries current active DB record by shortCode
  const currentLink = linkDb[job.code];
  if (currentLink && !currentLink.deleted) {
    analyticsDb.push({
      eventId: job.eventId,
      resolvedLinkId: currentLink.id, // Binds old event to new link ID!
      code: job.code
    });
  }
}

const eventsForNewLink = analyticsDb.filter(e => e.resolvedLinkId === 'link-uuid-2');
console.log(`Events recorded for re-created link (link-uuid-2): ${eventsForNewLink.length}`);
assert.strictEqual(eventsForNewLink.length, 3, 'Old unconsumed events for deleted link collided with re-created link!');
console.log('  [CONFIRMED] Duplicate analytics anomaly reproduced: clicks for re-created shortCode doubled/tripled.');

console.log('\n--- Step 5: Root Cause Summary ---');
console.log('1. Analytics jobs deferred in queue were resolved by mutable `code` rather than immutable `linkId`.');
console.log('2. Cache invalidation detached the cached mapping, allowing immediate re-creation before asynchronous queues drained.');
console.log('3. Remediated design requires binding analytics strictly to immutable `linkId` and purging/tagging queued events on delete.');

console.log('\nBREAK Reproduction: SUCCESS');
