'use strict';

const readline = require('readline');
const { parsePatternList } = require('./nameGenerator');

/** Menu rows for the name shape. Order is the order shown. */
const PATTERN_OPTIONS = [
  { key: '1', label: '3 letters             (3L)', patterns: ['3l'] },
  { key: '2', label: '3 chars, letters+dig (3C)', patterns: ['3c'] },
  { key: '3', label: '4 letters             (4L)', patterns: ['4l'] },
  { key: '4', label: '4 chars, letters+dig (4C)', patterns: ['4c'] },
  { key: '5', label: '5 letters             (5L)', patterns: ['5l'] },
  { key: '6', label: 'mixed cycle           4L -> 4C -> 3C', patterns: ['4l', '4c', '3c'] },
  { key: '7', label: 'custom                type your own', custom: true },
];

/** Menu rows for the mode. */
const MODE_OPTIONS = [
  { key: '1', label: 'hammer   - random names, keeps guessing', mode: 'hammer' },
  { key: '2', label: 'watch    - specific names from a file', mode: 'watch' },
];

const QUIT = '3';

/**
 * Turn a raw menu answer into a pattern list.
 * Returns null when the input is not usable so the caller can re-ask.
 */
function parseChoice(input, customValue) {
  const raw = String(input || '').trim().toLowerCase();

  if (raw === '7') {
    if (!customValue) return null;
    try {
      return parsePatternList(customValue);
    } catch (err) {
      return null;
    }
  }

  const row = PATTERN_OPTIONS.find((option) => option.key === raw);
  if (!row || row.custom) return null;
  return parsePatternList(row.patterns.join(' '));
}

/** Turn a raw answer into a mode, or null. */
function parseModeChoice(input) {
  const raw = String(input || '').trim().toLowerCase();
  const row = MODE_OPTIONS.find((option) => option.key === raw);
  if (row) return row.mode;
  if (raw === 'hammer' || raw === 'watch' || raw === 'watchlist') {
    return raw === 'hammer' ? 'hammer' : 'watch';
  }
  return null;
}

function renderModeMenu(stream) {
  stream.write('\n  pick a mode\n');
  stream.write('  -----------\n');
  for (const option of MODE_OPTIONS) {
    stream.write(`  ${option.key}. ${option.label}\n`);
  }
  stream.write(`  ${QUIT}. quit\n`);
  stream.write('\n  choice: ');
}

function renderMenu(stream) {
  stream.write('\n  pick a name shape\n');
  stream.write('  -----------------\n');
  for (const option of PATTERN_OPTIONS) {
    stream.write(`  ${option.key}. ${option.label}\n`);
  }
  stream.write('\n  choice: ');
}

/** Shared readline session, one interface for both menus. */
function createSession() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return {
    ask: (text) => new Promise((resolve) => rl.question(text, (answer) => resolve(answer))),
    close: () => rl.close(),
  };
}

/** Ask for a mode. Resolves 'hammer', 'watch', or null when quit. */
async function askMode() {
  const session = createSession();
  try {
    for (;;) {
      renderModeMenu(process.stdout);
      const answer = await session.ask('');
      if (String(answer).trim().toLowerCase() === QUIT) return null;
      const mode = parseModeChoice(answer);
      if (mode) return mode;
      process.stdout.write('  not a valid choice, try again\n\n');
    }
  } finally {
    session.close();
  }
}

/** Ask for a pattern list. Loops until a valid answer lands. */
async function askPatterns() {
  const session = createSession();
  try {
    for (;;) {
      renderMenu(process.stdout);
      const answer = await session.ask('');
      const looksCustom = String(answer).trim().toLowerCase() === '7';
      const custom = looksCustom ? await session.ask('  type pattern (e.g. 2n 5c 4l): ') : null;
      const patterns = parseChoice(answer, custom);
      if (patterns) {
        process.stdout.write(`  locked: ${patterns.map((p) => p.label).join(' -> ')}\n\n`);
        return patterns;
      }
      process.stdout.write('  not a valid choice, try again\n\n');
    }
  } finally {
    session.close();
  }
}

module.exports = {
  PATTERN_OPTIONS,
  MODE_OPTIONS,
  parseChoice,
  parseModeChoice,
  renderMenu,
  renderModeMenu,
  askMode,
  askPatterns,
};