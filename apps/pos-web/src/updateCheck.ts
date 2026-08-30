/**
 * Noticing that a new build has been deployed, without ever pulling the floor
 * out from under a sale.
 *
 * The service worker serves index.html stale-while-revalidate, so a till that
 * is already open keeps painting the shell it booted with until someone opens
 * it again. That is the right trade for a register — it starts instantly and
 * it starts during an outage — but it meant a deploy could sit unseen on a
 * till for the rest of a shift, and the only way to know was to notice the
 * screen looked wrong.
 *
 * Two things this deliberately does NOT do:
 *
 *   It does not poll the service worker. registration.update() re-fetches
 *   sw.js, and sw.js only changes when someone bumps CACHE by hand — so it
 *   says nothing at all about whether the app was rebuilt. version.json is
 *   the honest signal: the deploy stamps it with the commit
 *   (scripts/frontends-deploy-check.mjs), which is exactly the question.
 *
 *   It does not reload on its own. A register that refreshes itself mid-order
 *   is worse than one running yesterday's build. The operator is told, and
 *   taps when their hands are free.
 */

const POLL_MS = 5 * 60 * 1000;

type Version = { commit?: string };

export function watchForNewBuild() {
  if (typeof window === 'undefined' || typeof fetch !== 'function') return;

  // The commit this tab booted on. Read once, then compared — so nothing has
  // to be baked in at build time, which matters because version.json is
  // written at DEPLOY time, after the bundle exists.
  let booted: string | null = null;
  let announced = false;

  async function check() {
    if (announced) return;
    try {
      // no-store, and past the service worker's own cache-first rules: a
      // stale answer here is the one thing that would defeat the point.
      const response = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
      if (!response.ok) return; // dev, or not stamped — nothing to compare
      const { commit } = (await response.json()) as Version;
      if (!commit) return;
      if (booted === null) {
        booted = commit;
        return;
      }
      if (commit !== booted) announce();
    } catch {
      // Offline, or the host is unreachable. The register carries on; this is
      // the one part of the app allowed to simply not happen.
    }
  }

  function announce() {
    if (announced) return;
    announced = true;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pos-update-ready';
    button.textContent = 'New version ready · tap to load';
    button.addEventListener('click', () => {
      button.disabled = true;
      button.textContent = 'Loading…';
      // Give the worker a nudge first so the new shell is in cache before the
      // reload asks for it; reload regardless, because the shell is refreshed
      // in the background on this very navigation either way.
      const done = () => window.location.reload();
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistration().then((registration) => registration?.update()).then(done, done);
      } else {
        done();
      }
    });
    document.body.appendChild(button);
  }

  void check();
  window.setInterval(() => void check(), POLL_MS);
  // Coming back to a backgrounded till is the moment a deploy is most likely
  // to have happened since anyone last looked.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void check();
  });
}
