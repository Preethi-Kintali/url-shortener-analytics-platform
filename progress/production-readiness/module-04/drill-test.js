const { spawn } = require('child_process');
const http = require('http');

function req(path) {
  return new Promise((resolve, reject) => {
    http.get('http://127.0.0.1:3000' + path, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ statusCode: res.statusCode, data }));
    }).on('error', reject);
  });
}

async function drill() {
  console.log('--- Starting server for Module 04 Drill ---');
  const server = spawn(process.execPath, ['dist/main.js'], {
    cwd: 'D:\\Knack labs\\api',
    env: { ...process.env, FORCE_JSON_LOGS: 'true' },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let logs = '';
  server.stdout.on('data', d => logs += d.toString());
  server.stderr.on('data', d => logs += d.toString());

  // Wait for server ready
  let ready = false;
  for (let i = 0; i < 25; i++) {
    await new Promise(r => setTimeout(r, 400));
    try {
      const res = await req('/live');
      if (res.statusCode === 200) { ready = true; break; }
    } catch (e) {}
  }
  if (!ready) {
    console.error('Server failed to start. Logs:\n', logs);
    server.kill();
    process.exit(1);
  }

  console.log('Server is ready. Sending 10 GET /live requests...');
  for (let i = 0; i < 10; i++) {
    await req('/live');
  }

  console.log('Triggering 500 error via GET /debug/error...');
  const errRes = await req('/debug/error');
  console.log('Error endpoint status:', errRes.statusCode, errRes.data);

  console.log('Fetching GET /metrics...');
  const metricsRes = await req('/metrics');
  console.log('Metrics status:', metricsRes.statusCode);

  server.kill('SIGTERM');
  await new Promise(r => setTimeout(r, 800));

  console.log('\n--- Checking Metrics Output ---');
  const hasRequestsTotal = metricsRes.data.includes('http_requests_total{method="GET",path="/live",status="200"}');
  const has500Error = metricsRes.data.includes('http_requests_total{method="GET",path="/debug/error",status="500"} 1');
  const hasDuration = metricsRes.data.includes('http_request_duration_seconds_bucket');
  const hasGauges = metricsRes.data.includes('active_connections') && metricsRes.data.includes('urls_total');

  console.log('http_requests_total /live count tracked?:', hasRequestsTotal ? 'PASS' : 'FAIL');
  console.log('http_requests_total /debug/error status 500 incremented?:', has500Error ? 'PASS' : 'FAIL');
  console.log('http_request_duration_seconds histogram buckets present?:', hasDuration ? 'PASS' : 'FAIL');
  console.log('Gauge metrics present?:', hasGauges ? 'PASS' : 'FAIL');

  console.log('\n--- Checking Error Log Line ---');
  const errorLines = logs.split('\n').filter(l => l.includes('"error"') || l.includes('500') || l.includes('request_error'));
  console.log('Captured error log line:');
  console.log(errorLines[0] || 'No error line captured');

  console.log('\nDrill verification complete.');
}

drill().catch(console.error);
