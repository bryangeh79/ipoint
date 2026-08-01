/* iPoint Admin PWA safety boundary.
 *
 * This worker intentionally has no fetch, background-sync, periodic-sync,
 * push, cache, or queue handler. The browser therefore performs every request
 * directly and exactly once. Auth, MFA, session, market, sensitive projection,
 * audit, KYC, voucher, ledger, and privileged request data are never cached or
 * replayed by this worker.
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});
