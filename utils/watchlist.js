'use strict';

const fs = require('fs');
const path = require('path');

const MIN_LENGTH = 2;
const MAX_LENGTH = 32;
const VALID = /^[a-z0-9._]+$/;

/** Normalize a raw line into a Discord-safe lowercase username. */
function normalize(name) {
  return String(name || '').trim().toLowerCase();
}

/** Explain why a name is rejected, or null when it is usable. */
function rejectReason(name) {
  if (!name) return 'empty';
  if (name.length < MIN_LENGTH) return `shorter than ${MIN_LENGTH}`;
  if (name.length > MAX_LENGTH) return `longer than ${MAX_LENGTH}`;
  if (!VALID.test(name)) return 'has characters outside a-z 0-9 . _';
  if (name.includes('..')) return 'contains two dots in a row';
  if (name.startsWith('.') || name.endsWith('.')) return 'starts or ends with a dot';
  return null;
}

/**
 * Read a watch list file. One name per line, # starts a comment.
 * Returns { accepted, rejected } where rejected carries a reason.
 */
function loadNames(filePath) {
  const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`watch list not found: ${resolved}`);
  }

  const lines = fs.readFileSync(resolved, 'utf8').split(/\r?\n/);
  const accepted = [];
  const rejected = [];
  const seen = new Set();

  for (const line of lines) {
    const stripped = line.split('#')[0];
    const name = normalize(stripped);
    if (!name) continue;

    const why = rejectReason(name);
    if (why) {
      rejected.push({ name, why });
      continue;
    }
    if (seen.has(name)) {
      rejected.push({ name, why: 'duplicate' });
      continue;
    }
    seen.add(name);
    accepted.push(name);
  }

  return { accepted, rejected, path: resolved };
}

module.exports = { loadNames, normalize, rejectReason, MIN_LENGTH, MAX_LENGTH };
