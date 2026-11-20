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

async function runSimulations() {
  console.log('=== SIMULATION 1: Database Unreachable (Port 5433) ===');
  const server = spawn(process.execPath, ['dist/main.js'], {
    cwd: 'D:\\Knack labs\\api',
    env: {
      ...process.env,
      SKIP_DOTENV: 'true',
      APP_ENV: 'development',
      PORT: '3000',
      DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:5433/nonexistent?connect_timeout=2',
      JWT_SECRET: '18532533ac6b99a31ca90b85873ee9bc1561f5584ef23d7d01289d70966e4a1d',
      CORS_ORIGIN: 'http://localhost:3000',
      FORCE_JSON_LOGS: 'true'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let logs = '';
  server.stdout.on('data', d => logs += d.toString());
  server.stderr.on('data', d => logs += d.toString());

  // Wait for server to boot
  let ready = false;
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 400));
    try {
      const res = await req('/live');
      if (res.statusCode === 200) { ready = true; break; }
    } catch (e) {}
  }

  if (!ready) {
    console.error('Server failed to start in simulation. Logs:\n', logs);
    server.kill();
    process.exit(1);
  }

  console.log('Server is running. Probing /ready with dead DB...');
  const readyProbe = await req('/ready');
  console.log('GET /ready result:', readyProbe.statusCode, readyProbe.data);

  console.log('Probing /links with dead DB...');
  const linksProbe = await req('/links');
  console.log('GET /links result:', linksProbe.statusCode, linksProbe.data);

  server.kill('SIGTERM');
  await new Promise(r => setTimeout(r, 600));

  console.log('\n=== SIMULATION 2: 1ms Ultra-low Timeout Injection ===');
  const start = Date.now();
  try {
    await fetch('http://127.0.0.1:3000/live', { signal: AbortSignal.timeout(1) });
    console.log('Call unexpectedly succeeded');
  } catch (err) {
    const elapsed = Date.now() - start;
    console.log('Timeout caught successfully in', elapsed, 'ms!');
    console.log('Error type:', err.name, '| Message:', err.message);
  }

  console.log('\nBoth failure simulations completed.');
}

runSimulations().catch(console.error);
