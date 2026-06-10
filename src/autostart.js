import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { IS_SEA, ROOT } from './assets.js';

const run = promisify(execFile);
const KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const NAME = 'goxlr-streamlabs-sync';

// What Windows should launch at logon: the exe in hidden mode, or the
// windowless VBS launcher when running from source.
export function autostartCommand() {
  return IS_SEA
    ? `"${process.execPath}" --hidden`
    : `wscript.exe "${path.join(ROOT, 'start-hidden.vbs')}"`;
}

export async function getAutostart() {
  if (process.platform !== 'win32') return { enabled: false, command: '' };
  try {
    const { stdout } = await run('reg', ['query', KEY, '/v', NAME]);
    const m = stdout.match(/REG_SZ\s+(.+)/);
    return { enabled: true, command: m ? m[1].trim() : '' };
  } catch {
    return { enabled: false, command: '' };
  }
}

export async function setAutostart(enabled) {
  if (process.platform !== 'win32') throw new Error('Autostart is Windows-only');
  if (!enabled) {
    await run('reg', ['delete', KEY, '/v', NAME, '/f']).catch(() => {});
    return { enabled: false, command: '', warning: null };
  }
  const command = autostartCommand();
  await run('reg', ['add', KEY, '/v', NAME, '/t', 'REG_SZ', '/d', command, '/f']);
  const warning = /\\Temp\\/i.test(process.execPath)
    ? 'The executable is running from a temporary folder — move it somewhere permanent, run it again and re-enable autostart.'
    : null;
  return { enabled: true, command, warning };
}
