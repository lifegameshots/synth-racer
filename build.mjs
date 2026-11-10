import { build } from 'esbuild';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Production build.
 *
 * Vite/Rollup's native bundler crashes on this machine when the project path
 * contains non-ASCII characters, so the production build is done with
 * esbuild (pure Go, handles UTF-8 paths fine). Vite is still used for the dev
 * server and for previewing the built output.
 */

const root = process.cwd();
const dist = path.join(root, 'dist');

await rm(dist, { recursive: true, force: true });
await mkdir(path.join(dist, 'assets'), { recursive: true });

const result = await build({
  entryPoints: [path.join(root, 'src/main.ts')],
  bundle: true,
  format: 'esm',
  target: 'es2022',
  minify: true,
  sourcemap: false,
  legalComments: 'none',
  outdir: path.join(dist, 'assets'),
  entryNames: 'app',
  assetNames: 'app',
  loader: { '.css': 'css' },
  metafile: true,
  logLevel: 'warning',
});

const html = await readFile(path.join(root, 'index.html'), 'utf8');
const built = html.replace(
  /<script type="module" src="\/src\/main\.ts"><\/script>/,
  '<script type="module" src="./assets/app.js"></script>\n    <link rel="stylesheet" href="./assets/app.css" />',
);

if (built === html) {
  throw new Error('index.html script tag was not rewritten; build aborted.');
}

await writeFile(path.join(dist, 'index.html'), built, 'utf8');

// Optional: a 404 fallback so deep links still load the game.
await copyFile(path.join(dist, 'index.html'), path.join(dist, '404.html'));

for (const [file, meta] of Object.entries(result.metafile.outputs)) {
  if (!existsSync(path.join(root, file))) continue;
  const kb = (meta.bytes / 1024).toFixed(1);
  console.log(`  ${path.relative(root, file)}  ${kb} kB`);
}
console.log('build complete → dist/');
