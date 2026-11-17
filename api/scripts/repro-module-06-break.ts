import * as fs from 'fs';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';
import Redis from 'ioredis';
import { LinksService } from '../src/links/links.service';
import { RedisCacheService } from '../src/cache/redis-cache.service';
import { PrismaService } from '../src/prisma/prisma.service';

const evidenceDir = path.resolve(__dirname, '../../progress/evidence/module-06');
fs.mkdirSync(evidenceDir, { recursive: true });
const outFile = path.join(evidenceDir, 'break-stampede-repro.txt');
fs.writeFileSync(outFile, '', 'utf8');

function log(msg: string): void {
  console.log(msg);
  fs.appendFileSync(outFile, msg + '\n', 'utf8');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function stopServer(proc: ChildProcess): Promise<void> {
  if (proc.exitCode !== null || proc.killed) return;
  await new Promise<void>((resolve) => {
    const t = setTimeout(() => {
      try {
        proc.kill('SIGKILL');
      } catch {}
      resolve();
    }, 3000);
    proc.once('exit', () => {
      clearTimeout(t);
      resolve();
    });
    try {
      proc.kill('SIGTERM');
    } catch {
      clearTimeout(t);
      resolve();
    }
  });
}

async function startServer(port: number): Promise<{ proc: ChildProcess; allOutput: () => string }> {
  const apiDir = path.resolve(__dirname, '..');
  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];
  const proc = spawn('node', [path.join(apiDir, 'dist', 'main.js')], {
    cwd: apiDir,
    stdio: 'pipe',
    shell: false,
    env: {
      ...process.env,
      PORT: String(port),
      REDIS_URL: 'redis://localhost:6379',
      REDIS_TTL_SECONDS: '1',
    },
  });

  let outBuf = '';
  proc.stdout?.on('data', (c) => {
    outBuf += c.toString('utf8');
    const parts = outBuf.split(/\r?\n/);
    outBuf = parts.pop() || '';
    stdoutLines.push(...parts.filter(Boolean));
  });
  let errBuf = '';
  proc.stderr?.on('data', (c) => {
    errBuf += c.toString('utf8');
    const parts = errBuf.split(/\r?\n/);
    errBuf = parts.pop() || '';
    stderrLines.push(...parts.filter(Boolean));
  });

  for (let i = 0; i < 30; i++) {
    await sleep(300);
    try {
      const r = await fetch(`http://127.0.0.1:${port}/health`);
      if (r.status === 200) {
        return {
          proc,
          allOutput: () => [...stdoutLines, outBuf, ...stderrLines, errBuf].filter(Boolean).join('\n'),
        };
      }
    } catch {}
  }
  await stopServer(proc);
  throw new Error('Server failed to become healthy');
}

async function run(): Promise<void> {
  log('====================================================================');
  log('Module 06 BREAK Reproduction: Concurrent Hot-Key Miss Spike');
  log(`Timestamp: ${new Date().toISOString()}`);
  log('====================================================================\n');

  // Part 1: Deterministic DB-query fanout measurement under 25 concurrent misses (40ms simulated DB read)
  let dbCalls = 0;
  let cacheSets = 0;
  const simStore = new Map<string, string>();
  const mockPrisma = {
    link: {
      findUnique: async () => {
        dbCalls++;
        await sleep(40);
        return { code: 'hotBurst1', longUrl: 'https://example.com/popular-target' };
      },
    },
  } as unknown as PrismaService;
  const mockCache = {
    getDefaultTtlSeconds: () => 300,
    getRedirectTarget: async (code: string) => simStore.get(code) ?? null,
    setRedirectTarget: async (code: string, url: string) => {
      cacheSets++;
      simStore.set(code, url);
      return true;
    },
  } as unknown as RedisCacheService;

  const svc = new LinksService(mockPrisma, mockCache);
  const concurrentResults = await Promise.all(
    Array.from({ length: 25 }, () => svc.findByCode('hotBurst1')),
  );
  log('--- Part 1: 25 Concurrent Requests on Expired Key (40ms DB Latency) ---');
  log(`HTTP-equivalent resolved redirects: ${concurrentResults.length}/25`);
  log(`PostgreSQL findUnique calls triggered: ${dbCalls}`);
  log(`Redis setRedirectTarget writes triggered: ${cacheSets}\n`);

  // Part 2: Live HTTP server burst right after Redis TTL=1s expires on hot key
  const port = 3109;
  const srv = await startServer(port);
  const redis = new Redis('redis://localhost:6379', { lazyConnect: true });
  let linkId: string | null = null;
  let token = '';

  try {
    await redis.connect();
    const loginRes = await fetch(`http://127.0.0.1:${port}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'alice@example.com', password: 'dev-alice-secret-01' }),
    });
    token = ((await loginRes.json()) as { access_token: string }).access_token;

    const createRes = await fetch(`http://127.0.0.1:${port}/links`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ long_url: 'https://example.com/hot-campaign-link' }),
    });
    const link = (await createRes.json()) as { id: string; code: string };
    linkId = link.id;

    // Warm key with 1s TTL, then wait for natural TTL expiry
    await fetch(`http://127.0.0.1:${port}/r/${link.code}`, { redirect: 'manual' });
    await sleep(1200);

    // Fire 20 simultaneous GET /r/:code requests on expired key
    const burst = await Promise.all(
      Array.from({ length: 20 }, (_, idx) =>
        fetch(`http://127.0.0.1:${port}/r/${link.code}`, {
          redirect: 'manual',
          headers: { 'X-Request-Id': `req-m6-burst-${String(idx + 1).padStart(2, '0')}` },
        }),
      ),
    );
    await sleep(100);

    const status302Count = burst.filter((r) => r.status === 302).length;
    const logs = srv
      .allOutput()
      .split(/\r?\n/)
      .filter((l) => l.trim().startsWith('{'))
      .map((l) => JSON.parse(l) as Record<string, unknown>);

    const burstMissLogs = logs.filter(
      (e) =>
        e.event === 'cache_miss' &&
        e.code === link.code &&
        typeof e.request_id === 'string' &&
        e.request_id.startsWith('req-m6-burst-'),
    );
    const burstSetLogs = logs.filter(
      (e) =>
        e.event === 'cache_populated' &&
        e.code === link.code &&
        typeof e.request_id === 'string' &&
        e.request_id.startsWith('req-m6-burst-'),
    );

    log('--- Part 2: Live HTTP Burst (20 Concurrent GET /r/:code After TTL Expiry) ---');
    log(`Link code: ${link.code}`);
    log(`HTTP 302 responses: ${status302Count}/20`);
    log(`Burst cache_miss events logged for same code: ${burstMissLogs.length}`);
    log(`Burst cache_populated events logged for same code: ${burstSetLogs.length}`);
    for (const sample of burstMissLogs.slice(0, 5)) {
      log(`  ${JSON.stringify(sample)}`);
    }
  } finally {
    if (linkId && token) {
      await fetch(`http://127.0.0.1:${port}/links/${linkId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
    }
    redis.disconnect(false);
    await stopServer(srv.proc);
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

