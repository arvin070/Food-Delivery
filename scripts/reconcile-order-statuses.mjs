// Build the API first. Dry-run by default; each invocation scans at most 100 orders.
process.env.LOG_LEVEL ??= 'silent';
const { reconcileStatusBatch } = await import('../apps/api/dist/modules/orders/reconcile-status.js');
const { prisma } = await import('../apps/api/dist/core/prisma.js');
try {
  const args = process.argv.slice(2);
  const cursor = args.indexOf('--after');
  if (cursor >= 0 && !args[cursor + 1]) throw new Error('--after requires the previous batch cursor');
  const result = await reconcileStatusBatch(cursor < 0 ? '' : args[cursor + 1], args.includes('--apply'));
  console.log(JSON.stringify(result));
} finally { await prisma.$disconnect(); }
