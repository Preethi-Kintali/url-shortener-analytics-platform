/**
 * simulate-data-recovery.js
 *
 * Simulates the Module 05 BREAK data loss scenario:
 * 1. Attacker (203.0.113.42) executed unauthorized DELETE on 12 links across 8 user accounts (14:22:00 - 14:32:00 UTC).
 * 2. System uses soft deletes (deleted_at timestamp set), causing public redirects to fail (404/gone).
 * 3. Simulates recovery procedure: audit log identification, state preservation, targeted undelete, and redirect validation.
 */

const assert = require('assert');

// 1. In-memory database simulation of links table
const linksDb = [
  { id: 1, code: 'launch24', original_url: 'https://example.com/launch', user_id: 101, deleted_at: '2024-03-15T14:22:15Z', deleted_by_ip: '203.0.113.42' },
  { id: 2, code: 'promo50', original_url: 'https://example.com/promo', user_id: 102, deleted_at: '2024-03-15T14:23:00Z', deleted_by_ip: '203.0.113.42' },
  { id: 3, code: 'docs-api', original_url: 'https://docs.example.com/api', user_id: 103, deleted_at: '2024-03-15T14:24:10Z', deleted_by_ip: '203.0.113.42' },
  { id: 4, code: 'demo-deck', original_url: 'https://slides.example.com/deck', user_id: 104, deleted_at: '2024-03-15T14:25:30Z', deleted_by_ip: '203.0.113.42' },
  { id: 5, code: 'pricing', original_url: 'https://example.com/pricing', user_id: 101, deleted_at: '2024-03-15T14:26:00Z', deleted_by_ip: '203.0.113.42' },
  { id: 6, code: 'blog-ai', original_url: 'https://blog.example.com/ai', user_id: 105, deleted_at: '2024-03-15T14:27:12Z', deleted_by_ip: '203.0.113.42' },
  { id: 7, code: 'support', original_url: 'https://support.example.com', user_id: 106, deleted_at: '2024-03-15T14:28:05Z', deleted_by_ip: '203.0.113.42' },
  { id: 8, code: 'status', original_url: 'https://status.example.com', user_id: 107, deleted_at: '2024-03-15T14:29:18Z', deleted_by_ip: '203.0.113.42' },
  { id: 9, code: 'survey24', original_url: 'https://survey.example.com/2024', user_id: 102, deleted_at: '2024-03-15T14:30:00Z', deleted_by_ip: '203.0.113.42' },
  { id: 10, code: 'app-ios', original_url: 'https://apps.apple.com/app/123', user_id: 108, deleted_at: '2024-03-15T14:30:45Z', deleted_by_ip: '203.0.113.42' },
  { id: 11, code: 'app-android', original_url: 'https://play.google.com/store/123', user_id: 108, deleted_at: '2024-03-15T14:31:20Z', deleted_by_ip: '203.0.113.42' },
  { id: 12, code: 'webinar', original_url: 'https://zoom.us/j/123456789', user_id: 104, deleted_at: '2024-03-15T14:31:55Z', deleted_by_ip: '203.0.113.42' },
  // Normal unaffected link
  { id: 13, code: 'homepage', original_url: 'https://example.com', user_id: 109, deleted_at: null, deleted_by_ip: null }
];

console.log('--- Step 1: Auditing Affected Links ---');
const affectedRows = linksDb.filter(
  link => link.deleted_by_ip === '203.0.113.42' && link.deleted_at !== null
);
assert.strictEqual(affectedRows.length, 12, 'Must identify exactly 12 affected rows');
const affectedUsers = new Set(affectedRows.map(r => r.user_id));
assert.strictEqual(affectedUsers.size, 8, 'Must identify exactly 8 affected user accounts');
console.log(`Audited: ${affectedRows.length} rows affected across ${affectedUsers.size} user accounts.`);

console.log('\n--- Step 2: Reproducing Link Failure Pre-Recovery ---');
function resolveShortLink(code) {
  const link = linksDb.find(l => l.code === code && l.deleted_at === null);
  if (!link) {
    return { status: 404, error: 'Link not found or has been deleted' };
  }
  return { status: 302, redirectUrl: link.original_url };
}

// Check that deleted link fails to resolve
const preRecoveryCheck = resolveShortLink('launch24');
assert.strictEqual(preRecoveryCheck.status, 404, 'Deleted link must return 404 before restoration');
console.log(`Resolution test for 'launch24': HTTP ${preRecoveryCheck.status} (${preRecoveryCheck.error}) [CONFIRMED USER OUTAGE]`);

console.log('\n--- Step 3: Executing Safe Restoration Protocol ---');
// Create audit backup snapshot before restoration
const preRestoreSnapshot = JSON.parse(JSON.stringify(affectedRows));
console.log(`Preserved snapshot of ${preRestoreSnapshot.length} records prior to modification.`);

// Perform targeted undelete
let restoredCount = 0;
for (const row of linksDb) {
  if (row.deleted_by_ip === '203.0.113.42' && row.deleted_at !== null) {
    row.deleted_at = null;
    row.restored_at = new Date().toISOString();
    row.restored_reason = 'INCIDENT_RECOVERY_SEV1_AUTH_BYPASS';
    restoredCount++;
  }
}
assert.strictEqual(restoredCount, 12, 'Must restore all 12 affected links');
console.log(`Successfully restored ${restoredCount} links in the database.`);

console.log('\n--- Step 4: Validating Post-Recovery System State ---');
for (const original of preRestoreSnapshot) {
  const res = resolveShortLink(original.code);
  assert.strictEqual(res.status, 302, `Link '${original.code}' must resolve with HTTP 302`);
  assert.strictEqual(res.redirectUrl, original.original_url, `Link '${original.code}' must redirect to original destination`);
}
console.log('All 12 restored links successfully verified with active HTTP 302 redirects!');

console.log('\n--- Step 5: User Impact & Communication Summary ---');
console.log(`Total Impacted Users: ${affectedUsers.size}`);
console.log(`User IDs: ${Array.from(affectedUsers).join(', ')}`);
console.log(`Status: 100% data recovered from soft-delete state; proactive notification dispatch ready.`);
console.log('\nRecovery Simulation: PASS');
