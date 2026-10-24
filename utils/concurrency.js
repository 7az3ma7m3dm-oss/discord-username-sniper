'use strict';

/**
 * Run an async function over a list with a fixed number of workers.
 * Results keep the input order. Errors are returned in place of a value.
 */
async function mapLimit(items, limit, fn) {
  const size = Math.max(1, Math.min(limit || 1, items.length));
  const results = new Array(items.length);
  let cursor = 0;

  const worker = async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      try {
        results[index] = await fn(items[index], index);
      } catch (err) {
        results[index] = { error: err };
      }
    }
  };

  await Promise.all(Array.from({ length: size }, worker));
  return results;
}

/** Split an array into fixed-size chunks. */
function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

module.exports = { mapLimit, chunk };
