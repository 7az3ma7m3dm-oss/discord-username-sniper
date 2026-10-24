// utils/nameGenerator.js
'use strict';

const crypto = require('crypto');

const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
const DIGITS = '0123456789';
const ALNUM = LETTERS + DIGITS;

// L = letters only, C = letters + digits, N = digits only
const KINDS = { l: LETTERS, c: ALNUM, n: DIGITS };

/**
 * Parse a pattern token like "3c", "4l", "2n".
 * Returns { length, kind, alphabet, label }.
 */
function parsePattern(pattern) {
  const text = String(pattern || '').trim().toLowerCase();
  const match = /^(\d{1,2})([lcn])$/.exec(text);
  if (!match) {
    throw new Error(
      `bad pattern "${pattern}" - use <length><kind>: L=letters, C=letters+digits, N=digits (e.g. 3l 4c 2n)`,
    );
  }
  const length = Number(match[1]);
  if (length < 2 || length > 32) {
    throw new Error(`pattern "${pattern}": length must be 2-32`);
  }
  const kind = match[2];
  return { length, kind, alphabet: KINDS[kind], label: `${length}${kind}` };
}

/**
 * Parse a comma/space separated list: "4l,4c,3c"
 * Returns array of parsed patterns.
 */
function parsePatternList(value) {
  const parts = String(value || '')
    .split(/[,\s]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) throw new Error('no patterns given');
  return parts.map(parsePattern);
}

/**
 * Uniform random string over the pattern's alphabet.
 * crypto.randomInt keeps the distribution unbiased.
 */
function generateRandomName(pattern) {
  const spec = typeof pattern === 'string' ? parsePattern(pattern) : pattern;
  if (!spec || !spec.alphabet) throw new Error('generateRandomName needs a parsed pattern');

  let out = '';
  for (let i = 0; i < spec.length; i += 1) {
    out += spec.alphabet[crypto.randomInt(0, spec.alphabet.length)];
  }
  return out;
}

/**
 * Cycle the given patterns and yield unique candidates.
 * "4l,4c,3c" yields 4-letter, then 4-alnum, then 3-alnum, repeat.
 */
function* nameSequence(patterns) {
  const list = (Array.isArray(patterns) ? patterns : [patterns]).map((p) =>
    typeof p === 'string' ? parsePattern(p) : p,
  );
  if (list.length === 0) throw new Error('nameSequence needs at least one pattern');

  const seen = new Set();
  let index = 0;
  for (;;) {
    const spec = list[index % list.length];
    index += 1;
    const candidate = generateRandomName(spec);
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    yield { name: candidate, pattern: spec.label };
  }
}

module.exports = { parsePattern, parsePatternList, generateRandomName, nameSequence, KINDS };