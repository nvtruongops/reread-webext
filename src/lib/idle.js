/**
 * Work put off until the page has a quiet moment - or until a deadline, if
 * the moment never comes. A page loading its own content fires hundreds of
 * mutations, a reader finishing a part has just pressed a button: neither
 * has anything more urgent than the page staying readable, and neither may
 * wait forever. `requestIdleCallback` is that exact promise; where a
 * browser has none of it, a timer at the deadline is the same promise
 * without the early half.
 *
 * @param {() => void} work
 * @param {number} timeout milliseconds, the latest the work may run
 */
export function whenIdle(work, timeout) {
  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(() => work(), { timeout });
  } else {
    setTimeout(work, timeout);
  }
}
