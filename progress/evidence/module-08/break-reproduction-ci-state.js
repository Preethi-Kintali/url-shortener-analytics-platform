// ============================================================================
// MODULE 08 STEP 5: BREAK REPRODUCTION — CI PRISTINE STATE FAILURE
// ============================================================================
// Demonstrates the classic "Works on My Machine, Fails in CI" failure mode.
// AI-generated integration tests frequently assume pre-existing database seed state
// (users, teams, fixtures) present in local development, but absent in CI's
// pristine ephemeral environment.
// ============================================================================

const fs = require('fs');
const path = require('path');
const { TeamCollaborationEngine } = require('./team-collaboration-engine');

const logFile = path.join(__dirname, 'break-reproduction-output.txt');
let logBuffer = '';

function log(msg) {
  console.log(msg);
  logBuffer += msg + '\n';
}

function runLocalDevEnvironment() {
  log('------------------------------------------------------------------------');
  log('ENVIRONMENT A: LOCAL DEVELOPMENT (Dirty/Pre-Seeded State)');
  log('------------------------------------------------------------------------');
  const engine = new TeamCollaborationEngine();

  // Simulating lingering developer local database state:
  // Pre-existing user and team already seeded from earlier dev sessions
  log('[LOCAL SETUP] Pre-seeding existing database entities from dev session...');
  const seededTeam = engine.createTeam('usr_seeded_alice', 'Platform Engineering');
  log(`[LOCAL SETUP] Existing team present: id='${seededTeam.id}', owner='usr_seeded_alice'`);

  // AI-generated naive integration test: assumes team 'Platform Engineering' / seededTeam exists
  log('\n[RUNNING AI-GENERATED TEST] Executing Test: "Invite Collaborator and Post Comment"');
  try {
    // Naive test directly uses pre-existing team and owner without provisioning
    const invitation = engine.createInvitation(seededTeam.id, 'usr_seeded_alice', 'bob@knack.io', 'member');
    log(`[PASS] Invitation created successfully: token=${invitation.token}`);

    engine.acceptInvitation(invitation.token, 'usr_bob');
    log('[PASS] Bob accepted invitation');

    const task = engine.createTask(seededTeam.id, 'usr_bob', 'Ship Module 08');
    log(`[PASS] Task created: id=${task.id}`);

    const comment = engine.addComment(seededTeam.id, task.id, 'usr_bob', 'Ready to ship! cc @usr_seeded_alice');
    log(`[PASS] Comment posted: id=${comment.id}`);

    log('\n>>> LOCAL DEV TEST RESULT: ALL 4 STEPS PASSED (GREEN) <<<');
    log('Developer conclusion: "The feature and tests are completely working!"');
    return true;
  } catch (err) {
    log(`[FAIL] Local test failed unexpectedly: ${err.message}`);
    return false;
  }
}

function runCiEnvironment() {
  log('\n------------------------------------------------------------------------');
  log('ENVIRONMENT B: CI PIPELINE (Pristine Ephemeral Empty Database)');
  log('------------------------------------------------------------------------');
  const engine = new TeamCollaborationEngine();

  // In CI, the database is pristine and completely empty.
  log('[CI SETUP] Pristine container database initialized. Pre-existing records: 0');

  // The AI-generated test runs with hardcoded / assumed local fixture ID
  log('\n[RUNNING AI-GENERATED TEST IN CI] Executing Test: "Invite Collaborator and Post Comment"');
  const assumedLocalTeamId = 'team_seeded_core_101'; // ID assumed by test or looking up non-existent seed

  try {
    log(`[CI EXECUTION] Attempting to invite collaborator to assumed team: '${assumedLocalTeamId}'...`);
    engine.createInvitation(assumedLocalTeamId, 'usr_seeded_alice', 'bob@knack.io', 'member');
    log('[UNEXPECTED] CI test passed when it should have failed!');
    return true;
  } catch (err) {
    log(`[CI PIPELINE FAILURE - RED] Error caught during integration test:`);
    log(`  Status Code: ${err.statusCode || 500}`);
    log(`  Error Code:  ${err.code || 'UNKNOWN'}`);
    log(`  Message:     ${err.message}`);
    log('\n>>> CI PIPELINE RESULT: BUILD FAILED (EXIT CODE 1) <<<');
    log('Root Cause: Integration test made an ungrounded assumption of pre-existing database fixtures.');
    log('The test did not hermetically create its own prerequisites in a deterministic lifecycle.');
    return false;
  }
}

function main() {
  log('========================================================================');
  log('MODULE 08 STEP 5: BREAK — THE CI FAILURE REPRODUCTION');
  log(`Timestamp: ${new Date().toISOString()}`);
  log('Simulating "Works on My Machine vs Fails in CI" Environment Divergence');
  log('========================================================================\n');

  const localPassed = runLocalDevEnvironment();
  const ciPassed = runCiEnvironment();

  log('\n========================================================================');
  log('SUMMARY OF DIVERGENCE:');
  log(`  Local Environment: ${localPassed ? 'PASSED (Green)' : 'FAILED'}`);
  log(`  CI Environment:    ${ciPassed ? 'PASSED' : 'FAILED (Red)'}`);
  log('Diagnosis: AI test generator leaked environmental assumptions into integration suite.');
  log('========================================================================');

  fs.writeFileSync(logFile, logBuffer, 'utf8');
  log(`\nLog written to ${logFile}`);
}

main();
