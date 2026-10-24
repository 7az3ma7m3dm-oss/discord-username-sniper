
'use strict';

const { sleep, retryAfterMs } = require('./utils');

const DEFAULT_BACKOFF_MS = 1500;
const MAX_BACKOFF_MS = 30000;

/**
 * Decide what to do with an axios error from the username endpoint.
 * Returns one of:
 *   { action: 'retry', delayMs }  -> wait and try the next candidate
 *   { action: 'retry-same', delayMs } -> rate limited or transient, retry candidate
 *   { action: 'fatal', reason }   -> config/auth problem, stop the run
 */
function classifyError(err) {
  if (!err || !err.response) {
    // Socket error, DNS failure, timeout. Transient.
    return { action: 'retry', delayMs: DEFAULT_BACKOFF_MS, reason: err && err.code ? err.code : 'network' };
  }

  const status = err.response.status;
  const headers = err.response.headers || {};
  const body = err.response.data || {};

  if (status === 429) {
    const delayMs = Math.min(retryAfterMs(headers, DEFAULT_BACKOFF_MS), MAX_BACKOFF_MS);
    return { action: 'retry-same', delayMs, reason: 'rate limited' };
  }

  if (status === 401 || status === 403) {
    return { action: 'fatal', reason: 'token rejected or lacking permission' };
  }

  if (status === 400) {
    // Name taken, invalid, or password wrong. Distinguish if the body says so.
    const message = String(body.message || '').toLowerCase();
    if (message.includes('password')) {
      return { action: 'fatal', reason: 'password rejected' };
    }
    if (message.includes('captcha')) {
      return { action: 'fatal', reason: 'server requested verification' };
    }
    return { action: 'retry', delayMs: 0, reason: 'name unavailable' };
  }

  if (status >= 500) {
    const delayMs = Math.min(retryAfterMs(headers, DEFAULT_BACKOFF_MS), MAX_BACKOFF_MS);
    return { action: 'retry', delayMs, reason: `server ${status}` };
  }

  return { action: 'retry', delayMs: DEFAULT_BACKOFF_MS, reason: `http ${status}` };
}

/**
 * Exponential backoff helper for repeated network failures.
 */
function backoffMs(attempt) {
  return Math.min(DEFAULT_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
}

/**
 * Wait, then continue. Kept as a named helper so call sites read clean.
 */
async function waitFor(delayMs) {
  if (delayMs > 0) await sleep(delayMs);
}

module.exports = { classifyError, backoffMs, waitFor, MAX_BACKOFF_MS };