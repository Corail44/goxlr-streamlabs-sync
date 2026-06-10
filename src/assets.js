import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as sea from 'node:sea';

// True when running as a Single Executable Application (the packaged .exe).
export const IS_SEA = (() => {
  try {
    return sea.isSea();
  } catch {
    return false;
  }
})();

function devRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}

// Project root in dev, the .exe's folder when packaged (config.json lives there).
export const ROOT = IS_SEA ? path.dirname(process.execPath) : devRoot();

// Assets are read from disk in dev and from the embedded SEA blob in the .exe.
// `rel` is the path relative to the repo root, e.g. 'src/ui.html'.
export function readAssetText(rel) {
  if (IS_SEA) return sea.getAsset(rel, 'utf8');
  return fs.readFileSync(path.join(devRoot(), rel), 'utf8');
}

export function readAssetBuffer(rel) {
  if (IS_SEA) return Buffer.from(sea.getAsset(rel));
  return fs.readFileSync(path.join(devRoot(), rel));
}
