'use strict';

const readline = require('readline');
const { parsePatternList } = require('./nameGenerator');

/** Menu rows. Order is the order shown on the bench. */
const OPTIONS = [
  { key: '1', label: '3 letters            (3L)', patterns: ['3l'] },
  { key: '2', label: '3 chars, letters+dig (3C)', patterns: ['3c'] },
  { key: '3', label: '4 letters            (4L)', patterns: ['4l'] },
  { key: '4', label: '4 chars, letters+dig (4C)', patterns: ['4c'] },
  { key: '5', label: '5 letters            (5L)', patterns: ['5l'] },
  { key: '6', label: 'mixed cycle          4L -> 4C -> 3C', patterns: ['4l', '4c', '3c'] },
  { key: '7', label: 'custom               type your own', custom: true },
];

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

  const row = OPTIONS.find((option) => option.key === raw);
  if (!row || row.custom) return null;
  return parsePatternList(row.patterns.join(' '));
}

function renderMenu(stream) {
  stream.write('\n  pick a name shape\n');
  stream.write('  -----------------\n');
  for (const option of OPTIONS) {
    stream.write(`  ${option.key}. ${option.label}\n`);
  }
  stream.write('\n  choice: ');
}

/**
 * Ask the operator for a pattern list. Loops until a valid answer lands.
 */
function askPatterns() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const question = (text) =>
    new Promise((resolve) => {
      rl.question(text, (answer) => resolve(answer));
    });

  return (async () => {
    try {
      for (;;) {
        renderMenu(process.stdout);
        const answer = await question('');
        const looksCustom = String(answer).trim().toLowerCase() === '7';
        const custom = looksCustom ? await question('  type pattern (e.g. 2n 5c 4l): ') : null;
        const patterns = parseChoice(answer, custom);
        if (patterns) {
          process.stdout.write(`  locked: ${patterns.map((p) => p.label).join(' -> ')}\n\n`);
          return patterns;
        }
        process.stdout.write('  not a valid choice, try again\n\n');
      }
    } finally {
      rl.close();
    }
  })();
}

module.exports = { OPTIONS, parseChoice, renderMenu, askPatterns };
