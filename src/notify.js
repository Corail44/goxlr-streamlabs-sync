import { spawn } from 'node:child_process';

// Native Windows toast via a hidden PowerShell child, no dependency.
// Uses the PowerShell AUMID so it works without app registration.
const PS_TEMPLATE = `
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
$xml.LoadXml('<toast><visual><binding template="ToastGeneric"><text>__TITLE__</text><text>__BODY__</text></binding></visual></toast>')
$toast = New-Object Windows.UI.Notifications.ToastNotification($xml)
$appId = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe'
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show($toast)
`;

const escXml = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&apos;');

export function notify(title, body, logger) {
  if (process.platform !== 'win32') return;
  const script = PS_TEMPLATE.replaceAll('__TITLE__', escXml(title)).replaceAll('__BODY__', escXml(body));
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  try {
    spawn('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded], {
      stdio: 'ignore',
      windowsHide: true,
    }).unref();
  } catch (e) {
    logger?.debug?.(`[notify] toast failed: ${e.message}`);
  }
}

// Debounced notifier for connection losses: at most one toast per kind
// every 5 minutes, and only after a first successful connection.
export function makeConnectionNotifier({ enabled, logger }) {
  const lastSent = new Map();
  return (kind, message) => {
    if (!enabled) return;
    const now = Date.now();
    if (now - (lastSent.get(kind) ?? 0) < 5 * 60 * 1000) return;
    lastSent.set(kind, now);
    notify('goxlr-streamlabs-sync', message, logger);
  };
}
