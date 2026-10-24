'use strict';

/**
 * Availability probe for a candidate username.
 *
 * Tries the dedicated attempt endpoint first, which answers "is this taken"
 * without changing anything. Falls back to reporting "unknown" when the
 * endpoint is not offered, so the caller can decide to try a claim instead.
 */

const PROBE_PATHS = ['/users/@me/pomelo-attempt', '/unique-username/username-attempt'];

/**
 * Returns one of:
 *   { state: 'free' }              - safe to claim
 *   { state: 'taken' }             - someone has it
 *   { state: 'invalid' }           - server says the name is not allowed
 *   { state: 'unknown', reason }   - probe unsupported or inconclusive
 */
async function checkAvailability(client, username) {
  let lastReason = 'no probe answered';

  for (const probePath of PROBE_PATHS) {
    let res;
    try {
      res = await client.post(probePath, { username });
    } catch (err) {
      lastReason = err.code || err.message;
      continue;
    }

    if (res.status === 404 || res.status === 405 || res.status === 400) {
      lastReason = `probe ${probePath} answered ${res.status}`;
      continue;
    }

    if (res.status === 429) {
      return { state: 'unknown', reason: 'probe rate limited', retryAfter: res.headers };
    }

    if (res.status === 401 || res.status === 403) {
      return { state: 'unknown', reason: `probe rejected the token (${res.status})` };
    }

    if (res.status >= 500) {
      return { state: 'unknown', reason: `probe server error (${res.status})` };
    }

    if (res.status === 200 && res.data && typeof res.data.taken === 'boolean') {
      return { state: res.data.taken ? 'taken' : 'free' };
    }

    // Some responses carry the answer inside a message string.
    const message = String((res.data && res.data.message) || '').toLowerCase();
    if (message.includes('already taken')) return { state: 'taken' };
    if (message.includes('available')) return { state: 'free' };
    if (message.includes('invalid')) return { state: 'invalid' };

    lastReason = `probe ${probePath} answered ${res.status} with no verdict`;
  }

  return { state: 'unknown', reason: lastReason };
}

module.exports = { checkAvailability, PROBE_PATHS };
