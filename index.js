'use strict';

const { loadConfig, log, sleep } = require('./utils/utils');
const { nameSequence, parsePatternList } = require('./utils/nameGenerator');
const { askMode, askPatterns, closeMenus } = require('./utils/menu');
const { classifyError, waitFor } = require('./utils/errorHandling');
const { loadNames } = require('./utils/watchlist');
const { checkAvailability } = require('./utils/availability');
const { mapLimit } = require('./utils/concurrency');
const { colors, available, taken, unknown } = require('./utils/colors');
const { ResultLog } = require('./utils/report');
const {
  buildClient,
  updateUsername,
  notify,
  successEmbed,
  failureEmbed,
  fetchSelf,
} = require('./utils/apiService');

const MODE_WORDS = ['scan', 'hammer', 'watch', 'watchlist'];
const PATTERN_TOKEN = /^\d{1,2}[lcn]$/i;

/** Pull only real pattern tokens out of the CLI. */
function cliPatterns() {
  return process.argv
    .slice(2)
    .filter((a) => !a.startsWith('--'))
    .flatMap((a) => String(a).split(/[,\s]+/))
    .map((a) => a.trim())
    .filter((a) => PATTERN_TOKEN.test(a));
}

/** Patterns from CLI first, then config, then legacy fallback. */
function resolvePatterns(cfg) {
  const fromCli = cliPatterns();
  if (fromCli.length > 0) return parsePatternList(fromCli.join(' '));
  if (Array.isArray(cfg.namePatterns) && cfg.namePatterns.length > 0) {
    return parsePatternList(cfg.namePatterns.join(' '));
  }
  if (cfg.namePattern) return parsePatternList(cfg.namePattern);
  return parsePatternList([`${cfg.nameLength}${cfg.useLettersOnly ? 'l' : 'c'}`]);
}

/** Mode from CLI, config, or menu. */
async function pickMode(cfg) {
  const args = process.argv.slice(2);
  const fromCli = args.find((a) => MODE_WORDS.includes(a.toLowerCase()));
  if (fromCli) return fromCli.toLowerCase() === 'watchlist' ? 'watch' : fromCli.toLowerCase();
  if (args.includes('--no-menu') || cfg.menu === false) {
    return MODE_WORDS.includes(String(cfg.mode).toLowerCase()) ? cfg.mode : 'hammer';
  }
  return askMode();
}

/** Patterns for hammer/scan, honouring CLI and config. */
async function pickPatterns(cfg) {
  const args = process.argv.slice(2);
  if (cliPatterns().length > 0) return resolvePatterns(cfg);
  if (args.includes('--no-menu') || cfg.menu === false) return resolvePatterns(cfg);
  return askPatterns();
}

/** Human-readable reason for a failed claim. */
function describeClaimFailure(result) {
  const body = result.body || {};
  const parts = [];
  if (body.message) parts.push(body.message);
  if (body.errors) {
    try {
      const walk = (node, prefix) => {
        if (!node || typeof node !== 'object') return;
        for (const [key, value] of Object.entries(node)) {
          if (value && typeof value === 'object' && value._errors) {
            const message = value._errors.map((e) => e.message).join('; ');
            parts.push(`${prefix}${key}: ${message}`);
          } else if (value && typeof value === 'object') {
            walk(value, `${prefix}${key}.`);
          }
        }
      };
      walk(body.errors, '');
    } catch (err) {
      parts.push(String(body.errors));
    }
  }
  if (parts.length === 0) parts.push(`http ${result.status}`);
  return parts.join(' | ');
}

/** One colored result line. */
function printVerdict(name, verdict) {
  if (verdict.state === 'free') {
    process.stdout.write(`  ${available('AVAILABLE')} ${colors.green(colors.bold(name))}\n`);
    return;
  }
  if (verdict.state === 'taken') {
    process.stdout.write(`  ${taken('taken')}     ${colors.red(name)}\n`);
    return;
  }
  if (verdict.state === 'invalid') {
    process.stdout.write(`  ${unknown('invalid')}   ${colors.yellow(name)} ${colors.gray(verdict.reason || '')}\n`);
    return;
  }
  process.stdout.write(`  ${unknown('unknown')}   ${colors.yellow(name)} ${colors.gray(verdict.reason || '')}\n`);
}

/** Try to claim a name that reads as free. */
async function claim(cfg, client, name, store, accountTag) {
  const result = await updateUsername(client, name, cfg.password);

  if (result.ok) {
    const line = `HIT: username is now "${result.username}"`;
    console.log(`\n  ${available('CLAIMED')} ${colors.green(colors.bold(result.username))}`);
    log(line);
    store.available(result.username);
    await notify(cfg.webhookUrl, successEmbed(result.username, accountTag, 1, 0, 'claim'));
    return true;
  }

  const detail = describeClaimFailure(result);
  console.log(`  ${unknown('no claim')} ${colors.gray(`${name}: ${detail}`)}`);
  store.note(name, detail);
  return false;
}

/** Scan mode: probe a list or a generated batch, change nothing. */
async function runScan(cfg, targets, store) {
  const client = buildClient(cfg.token);
  log(`mode: scan | targets: ${targets.length} | concurrency: ${cfg.probeConcurrency}`);

  let free = 0;
  let takenCount = 0;
  let other = 0;
  let index = 0;

  await mapLimit(targets, cfg.probeConcurrency, async (name) => {
    const verdict = await checkAvailability(client, name);
    index += 1;
    printVerdict(name, verdict);

    if (verdict.state === 'free') {
      free += 1;
      store.available(name);
    } else if (verdict.state === 'taken') {
      takenCount += 1;
      store.taken(name);
    } else {
      other += 1;
      store.note(name, verdict.reason || verdict.state);
    }

    if (verdict.state === 'ratelimited') {
      await sleep(verdict.retryAfterMs || 5000);
    }
  });

  log(
    `scan done: ${free} available, ${takenCount} taken, ${other} unreadable | results saved to ${store.filePath}`,
  );
  return free > 0 ? 0 : 2;
}

/** Hammer mode: generate, probe, optionally claim. */
async function runHammer(cfg, patterns, store) {
  const client = buildClient(cfg.token);
  const self = await fetchSelf(client);
  if (!self) {
    log('could not read account: token or network problem. stopping.');
    return 1;
  }
  const accountTag = self.discriminator && self.discriminator !== '0'
    ? `${self.username}#${self.discriminator}`
    : self.username;

  log(`mode: hammer | account: ${accountTag} | shapes: ${patterns.map((p) => p.label).join(' -> ')}`);
  log(`concurrency: ${cfg.probeConcurrency} | claim on free: ${cfg.claimOnFree}`);

  const sequence = nameSequence(patterns);
  const batchSize = Math.max(cfg.probeConcurrency * 3, 6);
  let probeCount = 0;
  let freeCount = 0;

  for (;;) {
    const batch = [];
    for (let i = 0; i < batchSize; i += 1) batch.push(sequence.next().value);

    const verdicts = await mapLimit(batch, cfg.probeConcurrency, async (item) => {
      const verdict = await checkAvailability(client, item.name);
      return { item, verdict };
    });

    for (const row of verdicts) {
      if (!row || row.error) continue;
      probeCount += 1;
      printVerdict(row.item.name, row.verdict);
      if (row.verdict.state === 'free') {
        freeCount += 1;
        store.available(row.item.name);
        if (cfg.claimOnFree) {
          const won = await claim(cfg, client, row.item.name, store, accountTag);
          if (won && cfg.stopOnSuccess) return 0;
        }
      } else if (row.verdict.state === 'taken') {
        store.taken(row.item.name);
      } else {
        store.note(row.item.name, row.verdict.reason || row.verdict.state);
      }
    }

    log(`probed ${probeCount} | available ${freeCount}`);
    await sleep(cfg.batchDelayMs);
  }
}

/** Watch mode: poll a list, claim the first one that frees. */
async function runWatch(cfg, list, store) {
  const client = buildClient(cfg.token);
  const self = await fetchSelf(client);
  if (!self) {
    log('could not read account: token or network problem. stopping.');
    return 1;
  }
  const accountTag = self.discriminator && self.discriminator !== '0'
    ? `${self.username}#${self.discriminator}`
    : self.username;

  log(`mode: watch | account: ${accountTag} | targets: ${list.accepted.length} | interval: ${cfg.watchIntervalMs}ms`);

  let round = 0;
  for (;;) {
    round += 1;
    log(`round ${round}`);

    const verdicts = await mapLimit(list.accepted, cfg.probeConcurrency, async (name) => ({
      name,
      verdict: await checkAvailability(client, name),
    }));

    for (const row of verdicts) {
      if (!row || row.error) continue;
      printVerdict(row.name, row.verdict);
      if (row.verdict.state === 'free') store.available(row.name);
      else if (row.verdict.state === 'taken') store.taken(row.name);
      else store.note(row.name, row.verdict.reason || row.verdict.state);
    }

    const freeOnes = verdicts
      .filter((row) => row && row.verdict && row.verdict.state === 'free')
      .map((row) => row.name);

    for (const name of freeOnes) {
      const won = await claim(cfg, client, name, store, accountTag);
      if (won) return 0;
    }

    if (cfg.maxRounds > 0 && round >= cfg.maxRounds) {
      log(`round ceiling reached (${cfg.maxRounds}). stopping.`);
      await notify(cfg.webhookUrl, failureEmbed(`Round ceiling reached after ${round} round(s).`, round, null));
      return 2;
    }

    log(`round ${round} done, sleeping ${cfg.watchIntervalMs}ms`);
    await sleep(cfg.watchIntervalMs);
  }
}

/** Build the target list for scan mode. */
function scanTargets(cfg, list) {
  const args = process.argv.slice(2);
  if (cliPatterns().length > 0) {
    const patterns = resolvePatterns(cfg);
    const sequence = nameSequence(patterns);
    const out = [];
    for (let i = 0; i < cfg.scanCount; i += 1) out.push(sequence.next().value.name);
    return out;
  }
  if (list) return list.accepted;
  return [];
}

async function run() {
  const cfg = loadConfig();
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry');
  const store = new ResultLog(cfg.availableFile);

  let mode;
  let patterns;
  let list;
  try {
    mode = await pickMode(cfg);
    if (!mode) {
      log('menu closed, nothing to do.');
      return 0;
    }
    if (mode === 'hammer') patterns = await pickPatterns(cfg);
  } finally {
    closeMenus();
  }

  if (mode === 'watch' || mode === 'scan') {
    const loaded = loadNames(cfg.watchFile);
    log(`list: ${loaded.path} (${loaded.accepted.length} usable)`);
    loaded.rejected.forEach((entry) => log(`skipped "${entry.name}": ${entry.why}`));
    list = loaded;
  }

  if (mode === 'scan') {
    const targets = scanTargets(cfg, list);
    if (targets.length === 0) {
      log('nothing to scan. add names to names.txt or pass a shape like: scan 3c');
      return 4;
    }
    if (dryRun) {
      log(`dry run - would scan ${targets.length} name(s)`);
      targets.slice(0, 10).forEach((name, i) => log(`  ${i + 1}. ${name}`));
      return 0;
    }
    return runScan(cfg, targets, store);
  }

  if (mode === 'watch') {
    if (list.accepted.length === 0) {
      log('watch list has no usable names. stopping.');
      return 4;
    }
    if (dryRun) {
      log(`dry run - would watch ${list.accepted.length} name(s)`);
      list.accepted.forEach((name, i) => log(`  ${i + 1}. ${name}`));
      return 0;
    }
    return runWatch(cfg, list, store);
  }

  if (dryRun) {
    const sequence = nameSequence(patterns);
    log(`dry run - patterns: ${patterns.map((p) => p.label).join(' -> ')}`);
    for (let i = 0; i < 8; i += 1) {
      const sample = sequence.next().value;
      log(`sample ${i + 1}: ${sample.name} [${sample.pattern}]`);
    }
    return 0;
  }

  return runHammer(cfg, patterns, store);
}

if (require.main === module) {
  run()
    .then((code) => process.exit(code))
    .catch((err) => {
      log(`unhandled: ${err && err.stack ? err.stack : err}`);
      process.exit(1);
    });
}

module.exports = { run, resolvePatterns, pickMode, pickPatterns };
