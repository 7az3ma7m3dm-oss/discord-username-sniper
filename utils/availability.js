'use strict';

/**
 * Username availability probe.
 *
 * The attempt endpoint answers "free or taken" without changing anything.
 * It is the fast path: one request per name, no account changes.
 */

const PROBE_PATHS = ['/users/@me/pomelo-attempt'];

/**
 * One probe, no retries.
 * Returns { state, reason?, retryAfterMs? } where state is
 * 'free' | 'taken' | 'invalid' | 'ratelimited' | 'unknown'.
 */
async function probeOnce(client, username) {
  let lastReason = 'no probe path answered';

  for (const probePath of PROBE_PATHS) {
    let res;
    try {
      res = await client.post(probePath, { username });
    } catch (err) {
      lastReason = err.code || err.message;
      continue;
    }

    if (res.status === 429) {
      const header = res.headers || {};
      const seconds = parseFloat(header['retry-after']);
      return {
        state: 'ratelimited',
        reason: 'probe rate limited',
        retryAfterMs: Number.isNaN(seconds) ? 5000 : Math.ceil(seconds * 1000),
      };
    }

    if (res.status === 401 || res.status === 403) {
      return { state: 'unknown', reason: `token rejected (${res.status})` };
    }

    if (res.status === 404 || res.status === 405) {
      lastReason = `probe path missing (${res.status})`;
      continue;
    }

    if (res.status >= 500) {
      return { state: 'unknown', reason: `server error (${res.status})` };
    }

    const body = res.data || {};

    if (res.status === 200 && typeof body.taken === 'boolean') {
      return { state: body.taken ? 'taken' : 'free' };
    }

    const message = String(body.message || '').toLowerCase();
    if (message.includes('already taken')) return { state: 'taken' };
    if (message.includes('available')) return { state: 'free' };

    // Discord puts per-field errors under body.errors when a name is malformed.
    if (res.status === 400 && body.errors) {
      return { state: 'invalid', reason: JSON.stringify(body.errors) };
    }

    lastReason = `probe answered ${res.status} with no verdict`;
  }

  return { state: 'unknown', reason: lastReason };
}

/**
 * Probe with a short retry on rate limits.
 * retries default 2, so a single name costs at most three requests.
 */
async function checkAvailability(client, username, options = {}) {
  const retries = Number.isInteger(options.retries) ? options.retries : 2;
  const sleep = options.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));

  let attempt = 0;
  for (;;) {
    const verdict = await probeOnce(client, username);
    if (verdict.state !== 'ratelimited' || attempt >= retries) return verdict;
    attempt += 1;
    await sleep(verdict.retryAfterMs || 5000);
  }
}

module.exports = { checkAvailability, probeOnce, PROBE_PATHS };
