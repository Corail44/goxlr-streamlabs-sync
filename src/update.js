const RELEASES_API = 'https://api.github.com/repos/Corail44/goxlr-streamlabs-sync/releases/latest';
export const RELEASES_URL = 'https://github.com/Corail44/goxlr-streamlabs-sync/releases';

function isNewer(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return true;
    if ((pa[i] || 0) < (pb[i] || 0)) return false;
  }
  return false;
}

// Polls the GitHub releases API (anonymous, once at startup then daily) and
// reports through onUpdate when a newer version exists.
export function startUpdateChecker({ version, enabled, logger, onUpdate }) {
  if (!enabled) return;

  const check = async () => {
    try {
      const res = await fetch(RELEASES_API, {
        headers: { 'user-agent': `goxlr-streamlabs-sync/${version}`, accept: 'application/vnd.github+json' },
      });
      if (!res.ok) return;
      const rel = await res.json();
      const latest = String(rel.tag_name ?? '').replace(/^v/, '');
      if (latest && isNewer(latest, version)) {
        logger.warn(`[update] v${latest} is available (you run v${version}): ${rel.html_url}`);
        onUpdate({ available: true, latest, url: rel.html_url ?? RELEASES_URL });
      }
    } catch (e) {
      logger.debug(`[update] check failed: ${e.message}`);
    }
  };

  setTimeout(check, 5000);
  setInterval(check, 24 * 3600 * 1000).unref?.();
}
