// When the maintenance-mode process may stop itself (server/maintenance.ts).
// Pure, so the rule can be tested without a server, a queue or a clock.

export interface IdleState {
  now: number;
  bootedAt: number;
  /** End of the last request that counts as activity (health checks do not). */
  lastActivityAt: number;
  /** Requests started and not yet finished. */
  inFlight: number;
  /** A job is running, due now, or due within the idle window. */
  queueBusy: boolean;
  idleMs: number;
}

/**
 * True only when nothing is happening and nothing is about to: no request in
 * hand, none for a whole idle window, no job running or due soon, and the
 * process has been up for at least one window (so a boot that a webhook
 * caused has time to receive the retry of that webhook).
 */
export function shouldStop(s: IdleState): boolean {
  if (s.inFlight > 0) return false;
  if (s.queueBusy) return false;
  if (s.now - s.bootedAt < s.idleMs) return false;
  return s.now - s.lastActivityAt >= s.idleMs;
}
