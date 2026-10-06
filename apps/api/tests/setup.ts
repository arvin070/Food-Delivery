/**
 * Test bootstrap.
 *
 * Tests run against the same local Postgres as development but inside their own
 * records: every suite creates users under a unique `@test.lunch` identifier and
 * removes them afterwards. That keeps the suite honest — it exercises real
 * constraints, transactions and Prisma behaviour rather than a mock.
 */
process.env['NODE_ENV'] = 'test';
process.env['LOG_LEVEL'] ??= 'silent';
// Keep bcrypt cheap so the suite stays fast.
process.env['BCRYPT_ROUNDS'] = '4';
