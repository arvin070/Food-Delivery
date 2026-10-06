#!/usr/bin/env node
/**
 * Local development database.
 *
 * Runs a real PostgreSQL 16 server from the `embedded-postgres` package so
 * developers need neither Docker nor a system-wide Postgres install. Data lives
 * in `.pgdata/` at the repo root and survives restarts.
 *
 *   node scripts/dev-db.mjs start   # initialise (first run) + start, detached
 *   node scripts/dev-db.mjs stop
 *   node scripts/dev-db.mjs status
 *
 * Production uses a managed Postgres via DATABASE_URL — this script is dev-only.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = resolve(ROOT, '.pgdata');
const PID_FILE = resolve(DATA_DIR, 'lunch-dev.pid');

const CONFIG = {
  user: 'lunch',
  password: 'lunch',
  database: 'lunch',
  port: 55432,
  persistent: true,
  databaseDir: resolve(DATA_DIR, 'cluster'),
};

const isUp = (port) =>
  new Promise((res) => {
    const s = net.connect({ host: '127.0.0.1', port, timeout: 800 });
    s.on('connect', () => (s.destroy(), res(true)));
    s.on('error', () => res(false));
    s.on('timeout', () => (s.destroy(), res(false)));
  });

async function loadEmbeddedPostgres() {
  try {
    const mod = await import('embedded-postgres');
    return mod.default ?? mod.EmbeddedPostgres;
  } catch {
    console.error(
      '\n  `embedded-postgres` is not installed.\n' +
        '  Run `npm install` at the repo root, or start Postgres yourself:\n' +
        '    docker compose up -d postgres\n'
    );
    process.exit(1);
  }
}

async function start() {
  if (await isUp(CONFIG.port)) {
    console.log(`Postgres already listening on 127.0.0.1:${CONFIG.port}`);
    return;
  }
  mkdirSync(DATA_DIR, { recursive: true });
  const EmbeddedPostgres = await loadEmbeddedPostgres();
  const pg = new EmbeddedPostgres(CONFIG);

  const firstRun = !existsSync(resolve(CONFIG.databaseDir, 'PG_VERSION'));
  if (firstRun) {
    console.log('Initialising a fresh Postgres cluster (first run, downloads binaries)…');
    await pg.initialise();
  }
  await pg.start();
  if (firstRun) {
    try {
      await pg.createDatabase(CONFIG.database);
    } catch (err) {
      if (!/already exists/i.test(String(err?.message))) throw err;
    }
  }
  writeFileSync(PID_FILE, String(process.pid));
  console.log(
    `Postgres up on 127.0.0.1:${CONFIG.port}\n` +
      `  DATABASE_URL="postgresql://${CONFIG.user}:${CONFIG.password}@127.0.0.1:${CONFIG.port}/${CONFIG.database}?schema=public"`
  );

  // `embedded-postgres` keeps the server as a child process, so this script has
  // to stay alive. Callers run it detached (npm run db:start &) or in a pane.
  const shutdown = async () => {
    try { await pg.stop(); } catch {}
    try { rmSync(PID_FILE, { force: true }); } catch {}
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  setInterval(() => {}, 1 << 30);
}

async function stop() {
  if (existsSync(PID_FILE)) {
    const pid = Number(readFileSync(PID_FILE, 'utf8').trim());
    try {
      process.kill(pid, 'SIGTERM');
      console.log(`Signalled dev database (pid ${pid}) to stop.`);
      return;
    } catch {
      rmSync(PID_FILE, { force: true });
    }
  }
  console.log('No dev database process recorded. If one is running, stop it manually.');
}

async function status() {
  const up = await isUp(CONFIG.port);
  console.log(up ? `Postgres is UP on 127.0.0.1:${CONFIG.port}` : 'Postgres is DOWN');
  process.exit(up ? 0 : 1);
}

const cmd = process.argv[2] ?? 'start';
const commands = { start, stop, status };
if (!commands[cmd]) {
  console.error(`Unknown command "${cmd}". Use: start | stop | status`);
  process.exit(1);
}
await commands[cmd]();
