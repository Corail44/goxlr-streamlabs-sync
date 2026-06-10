import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { IS_SEA, ROOT, readAssetBuffer } from './assets.js';
import { openInBrowser } from './webui.js';

// Windows system-tray icon without any dependency: a hidden PowerShell child
// hosts a WinForms NotifyIcon and reports menu clicks on stdout ('open'/'quit').
// It also watches our PID and removes itself if we die.
const PS_TEMPLATE = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$ni = New-Object System.Windows.Forms.NotifyIcon
try { $ni.Icon = New-Object System.Drawing.Icon('__ICON__') } catch { $ni.Icon = [System.Drawing.SystemIcons]::Application }
$ni.Text = 'GoXLR Streamlabs Sync'
$menu = New-Object System.Windows.Forms.ContextMenuStrip
$open = New-Object System.Windows.Forms.ToolStripMenuItem('__OPEN__')
$open.add_Click({ [Console]::Out.WriteLine('open'); [Console]::Out.Flush() })
$quit = New-Object System.Windows.Forms.ToolStripMenuItem('__QUIT__')
$quit.add_Click({ [Console]::Out.WriteLine('quit'); [Console]::Out.Flush(); $ni.Visible = $false; [System.Windows.Forms.Application]::Exit() })
[void]$menu.Items.Add($open)
[void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
[void]$menu.Items.Add($quit)
$ni.ContextMenuStrip = $menu
$ni.add_MouseDoubleClick({ [Console]::Out.WriteLine('open'); [Console]::Out.Flush() })
$ni.Visible = $true
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 3000
$timer.add_Tick({ try { Get-Process -Id __PID__ -ErrorAction Stop | Out-Null } catch { $ni.Visible = $false; [System.Windows.Forms.Application]::Exit() } })
$timer.Start()
[System.Windows.Forms.Application]::Run()
$ni.Dispose()
`;

export function startTray({ url, logger, onQuit }) {
  if (process.platform !== 'win32') return null;

  let iconPath = path.join(ROOT, 'assets', 'icon.ico');
  if (IS_SEA) {
    try {
      iconPath = path.join(os.tmpdir(), 'goxlr-streamlabs-sync.ico');
      fs.writeFileSync(iconPath, readAssetBuffer('assets/icon.ico'));
    } catch {
      iconPath = '';
    }
  }

  const fr = (Intl.DateTimeFormat().resolvedOptions().locale || '').toLowerCase().startsWith('fr');
  const script = PS_TEMPLATE.replaceAll('__ICON__', iconPath.replaceAll("'", "''"))
    .replaceAll('__OPEN__', fr ? 'Ouvrir le dashboard' : 'Open dashboard')
    .replaceAll('__QUIT__', fr ? 'Quitter' : 'Quit')
    .replaceAll('__PID__', String(process.pid));
  const encoded = Buffer.from(script, 'utf16le').toString('base64');

  let child;
  try {
    child = spawn(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded],
      { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }
    );
  } catch (e) {
    logger.debug(`[tray] failed to start: ${e.message}`);
    return null;
  }

  child.on('error', (e) => logger.debug(`[tray] error: ${e.message}`));
  child.stdout.setEncoding('utf8');
  let buf = '';
  child.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line === 'open') openInBrowser(url, logger);
      else if (line === 'quit') {
        logger.info('[tray] Quit requested from the tray icon.');
        onQuit();
      }
    }
  });
  child.on('exit', () => logger.debug('[tray] tray process exited'));
  process.on('exit', () => {
    try {
      child.kill();
    } catch {}
  });

  logger.ok('[tray] Tray icon ready (notification area)');
  return child;
}
