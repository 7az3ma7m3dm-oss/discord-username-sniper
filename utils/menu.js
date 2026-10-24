'use strict';

const readline = require('readline');
const { parsePatternList } = require('./nameGenerator');
const { colors } = require('./colors');

/** Menu rows for the name shape. Order is the order shown. */
const PATTERN_OPTIONS = [
  { key: '1', label: '3 letters             (3L)', patterns: ['3l'] },
  { key: '2', label: '3 chars, letters+dig (3C)', patterns: ['3c'] },
  { key: '3', label: '4 letters             (4L)', patterns: ['4l'] },
  { key: '4', label: '4 chars, letters+dig (4C)', patterns: ['4c'] },
  { key: '5', label: '5 letters             (5L)', patterns: ['5l'] },
  { key: '6', label: '6 chars, letters+dig (6C)', patterns: ['6c'] },
  { key: '7', label: 'mixed cycle           4L -> 4C -> 3C', patterns: ['4l', '4c', '3c'] },
  { key: '8', label: 'custom                type your own', custom: true },
];

/** Menu rows for the mode. */
const MODE_OPTIONS = [
  { key: '1', label: 'scan', text: 'check names only, change nothing', mode: 'scan' },
  { key: '2', label: 'hammer', text: 'random names, probe each one', mode: 'hammer' },
  { key: '3', label: 'watch', text: 'file list, claim the moment one frees', mode: 'watch' },
];

const QUIT = '4';

// One readline session for the whole menu flow. Closing and reopening
// stdin between prompts loses buffered piped input.
let session = null;

function getSession() {
  if (!session) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const queue = [];
    let pending = null;

    rl.on('line', (line) => {
      if (pending) {
        const resolve = pending;
        pending = null;
        resolve(line);
      } else {
        queue.push(line);
      }
    });

    session = {
      ask: (text) => {
        if (text) process.stdout.write(text);
        if (queue.length > 0) return Promise.resolve(queue.shift());
        return new Promise((resolve) => {
          pending = resolve;
        });
      },
      close: () => {
        rl.close();
        session = null;
      },
    };
  }
  return session;
}

/** Close the shared menu session. Safe to call twice. */
function closeMenus() {
  if (session) session.close();
}

/** Turn a raw menu answer into a pattern list, or null. */
function parseChoice(input, customValue) {
  const raw = String(input || '').trim().toLowerCase();

  if (raw === '8') {
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
  if (['scan', 'hammer', 'watch', 'watchlist'].includes(raw)) {
    return raw === 'watchlist' ? 'watch' : raw;
  }
  return null;
}

function box(lines) {
  const width = Math.max(...lines.map((line) => line.replace(/\x1b\[[0-9;]*m/g, '').length)) + 2;
  const top = `  ${colors.cyan('┌')}${colors.cyan('─'.repeat(width))}${colors.cyan('┐')}`;
  const bottom = `  ${colors.cyan('└')}${colors.cyan('─'.repeat(width))}${colors.cyan('┘')}`;
  const body = lines.map((line) => {
    const plain = line.replace(/\x1b\[[0-9;]*m/g, '');
    const pad = ' '.repeat(width - plain.length - 1);
    return `  ${colors.cyan('│')} ${line}${pad}${colors.cyan('│')}`;
  });
  return [top, ...body, bottom].join('\n');
}

function renderModeMenu(stream) {
  const lines = [
    `${colors.bold('username sniper')}  ${colors.gray('probe, hammer, watch')}`,
    '',
    ...MODE_OPTIONS.map(
      (option) => `${colors.cyan(option.key)}  ${colors.bold(option.label.padEnd(7))} ${colors.gray(option.text)}`,
    ),
    `${colors.cyan(QUIT)}  ${colors.bold('quit')}`,
  ];
  stream.write(`\n${box(lines)}\n\n  choice: `);
}

function renderMenu(stream) {
  const lines = [
    `${colors.bold('pick a name shape')}`,
    '',
    ...PATTERN_OPTIONS.map(
      (option) => `${colors.cyan(option.key)}  ${option.label}  ${colors.gray(option.patterns || '')}`,
    ),
  ];
  stream.write(`\n${box(lines)}\n\n  choice: `);
}

/** Ask for a mode. Resolves 'scan' | 'hammer' | 'watch' | null. */
async function askMode() {
  const io = getSession();
  for (;;) {
    renderModeMenu(process.stdout);
    const answer = await io.ask('');
    if (String(answer).trim() === QUIT) return null;
    const mode = parseModeChoice(answer);
    if (mode) {
      process.stdout.write(`  ${colors.green('mode')} ${colors.bold(mode)}\n`);
      return mode;
    }
    process.stdout.write(`  ${colors.red('not a valid choice')}\n`);
  }
}

/** Ask for a pattern list. Loops until a valid answer lands. */
async function askPatterns() {
  const io = getSession();
  for (;;) {
    renderMenu(process.stdout);
    const answer = await io.ask('');
    const looksCustom = String(answer).trim() === '8';
    const custom = looksCustom ? await io.ask('  type pattern (e.g. 2n 5c 4l): ') : null;
    const patterns = parseChoice(answer, custom);
    if (patterns) {
      process.stdout.write(`  ${colors.green('shape')} ${colors.bold(patterns.map((p) => p.label).join(' -> '))}\n\n`);
      return patterns;
    }
    process.stdout.write(`  ${colors.red('not a valid choice')}\n`);
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
  closeMenus,
};
