// Builds the standalone Windows executable (Node SEA):
//   1. esbuild bundles src/ into a single CommonJS file
//   2. node --experimental-sea-config produces the SEA blob (with embedded assets)
//   3. the blob is injected into a copy of node.exe via postject
//   4. SHA256SUMS.txt is written next to the exe
//
//   npm run build:exe        ->  build/goxlr-streamlabs-sync.exe
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUILD = path.join(ROOT, 'build');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const EXE = path.join(BUILD, 'goxlr-streamlabs-sync.exe');

fs.rmSync(BUILD, { recursive: true, force: true });
fs.mkdirSync(BUILD, { recursive: true });

console.log('[1/4] Bundling with esbuild...');
const esbuild = await import('esbuild');
await esbuild.build({
  entryPoints: [path.join(ROOT, 'src', 'index.js')],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  outfile: path.join(BUILD, 'bundle.cjs'),
  define: { __GSS_VERSION__: JSON.stringify(pkg.version) },
  logLevel: 'warning',
});

console.log('[2/4] Generating SEA blob...');
const seaConfig = {
  main: 'build/bundle.cjs',
  output: 'build/sea-prep.blob',
  disableExperimentalSEAWarning: true,
  assets: {
    'src/ui.html': 'src/ui.html',
    'src/overlay.html': 'src/overlay.html',
    'src/vendor/qrcode-generator.js': 'src/vendor/qrcode-generator.js',
    'assets/icon.ico': 'assets/icon.ico',
  },
};
fs.writeFileSync(path.join(BUILD, 'sea-config.json'), JSON.stringify(seaConfig, null, 2));
execFileSync(process.execPath, ['--experimental-sea-config', 'build/sea-config.json'], {
  cwd: ROOT,
  stdio: 'inherit',
});

console.log('[3/4] Injecting blob into node.exe copy...');
fs.copyFileSync(process.execPath, EXE);
const { inject } = await import('postject');
await inject(EXE, 'NODE_SEA_BLOB', fs.readFileSync(path.join(BUILD, 'sea-prep.blob')), {
  sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
});

console.log('[4/4] Writing SHA256SUMS.txt...');
const hash = crypto.createHash('sha256').update(fs.readFileSync(EXE)).digest('hex');
fs.writeFileSync(path.join(BUILD, 'SHA256SUMS.txt'), `${hash}  goxlr-streamlabs-sync.exe\n`);

const mb = (fs.statSync(EXE).size / 1024 / 1024).toFixed(1);
console.log(`\nDone: ${EXE} (${mb} MB, v${pkg.version})`);
console.log(`SHA256: ${hash}`);
