/** Replay the entire migration chain into a disposable LOCAL database, then
 * compare it with Prisma's model. Never resets or migrates the application DB. */
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
dotenv.config({ path: '.env' });
const url = new URL(process.env.DATABASE_URL);
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Migration verification requires a local database');
const name = 'lunch_verify_' + randomUUID().replaceAll('-', '');
const admin = new PrismaClient({ datasources: { db: { url: url.toString() } } });
const target = new URL(url); target.pathname = '/' + name;
let created = false;
function prisma(args, databaseUrl) {
  const result = spawnSync(process.execPath, ['../../node_modules/prisma/build/index.js', ...args], {
    cwd: 'apps/api', env: { ...process.env, DATABASE_URL: databaseUrl }, encoding: 'utf8',
  });
  if (result.status !== 0) { process.stdout.write(result.stdout); process.stderr.write(result.stderr); throw new Error('Migration verification failed'); }
}
try {
  // Identifier is generated above and contains only letters, underscores and hex.
  await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`); created = true;
  prisma(['migrate', 'deploy'], target.toString());
  prisma(['migrate', 'diff', '--from-schema-datasource', 'prisma/schema.prisma', '--to-schema-datamodel', 'prisma/schema.prisma', '--exit-code'], target.toString());
  console.log('PASS: full migration chain replays into an empty database with no schema drift');
  prisma(['migrate', 'diff', '--from-schema-datasource', 'prisma/schema.prisma', '--to-schema-datamodel', 'prisma/schema.prisma', '--exit-code'], url.toString());
  console.log('PASS: local application database matches the declared Prisma schema');
} finally {
  if (created) await admin.$executeRawUnsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
  await admin.$disconnect();
}
