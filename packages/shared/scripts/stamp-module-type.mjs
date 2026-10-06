/**
 * Marks each build output with its module system.
 *
 * The package itself has no top-level `"type"`, so Node would read both builds
 * as CommonJS. A nested package.json in each output directory tells Node (and
 * bundlers) how to interpret the `.js` files it contains.
 */
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

for (const [dir, type] of [
  ['dist/cjs', 'commonjs'],
  ['dist/esm', 'module'],
]) {
  writeFileSync(resolve(root, dir, 'package.json'), `${JSON.stringify({ type }, null, 2)}\n`);
}

console.log('Stamped dist/cjs (commonjs) and dist/esm (module).');
