/**
 * @lunch/shared — contracts shared by the API and every client.
 *
 * Nothing in here may import from `@lunch/api` or `@lunch/web`, and nothing in
 * here may touch Node or browser globals: it has to run in both.
 */
export * from './enums/index.js';
export * from './schemas/index.js';
export * from './errors.js';
export * from './money.js';
