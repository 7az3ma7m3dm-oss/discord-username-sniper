'use strict';

const { loadConfig, log, sleep } = require('./utils/utils');
const { nameSequence, parsePatternList } = require('./utils/nameGenerator');
const { askMode, askPatterns } = require('./utils/menu');
const { classifyError, waitFor } = require('./utils/errorHandling');
const { loadNames } = require('./utils/watchlist');
const { checkAvailability } = require('./utils/availability');
const {
  buildClient,
  updateUsername,
  notify,
  successEmbed,
  failureEmbed,
  fetchSelf,
} = require('./utils/apiService');

const MODE_WORDS = ['hammer', 'watch', 'watchlist'];
const PATTERN_TOKEN = /^\d{1,2}[lcn]$/i;

/**
 * Pull only real pattern tokens out of the CLI.
 * Shell comments and stray words are dropped instead of crashing the parse.
 */
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
  if (fromCli) return fromCli.toLowerCase() === 'hammer' ? 'hammer' : 'watch';

  if (args.includes('--no-menu') || cfg.menu === false) {
    return cfg.mode === 'watch' ? 'watch' : 'hammer';
  }

  return askMode();
}

/** Patterns for hammer mode, honouring CLI and config. */
async function pickPatterns(cfg) {
  const args = process.argv.slice(2);
  const hasCliPattern = cliPatterns().length > 0;

  if (hasCliPattern) return resolvePatterns(cfg);
  if (args.includes('--no-menu') || cfg.menu === false) return resolvePatterns(cfg);
  return askPatterns();
}

/** Sample preview, no network. */
function preview(patterns, names) {
  if (names) {
    log(`dry run - watch list: ${names.accepted.length} usable name(s)`);
    names.accepted.forEach((name, index) => log(`target ${index + 1}: ${name}`));
    names.rejected.forEach((entry) => log(`skipped "${entry.name}": ${entry.why}`));
    return;
  }
  const sequence = nameSequence(patterns);
  log(`dry run - patterns: ${patterns.map((p) => p.label).join(' -> ')}`);
  for (let i = 0; i < 8; i += 1) {
    const sample = sequence.next().value;
    log(`sample ${i + 1}: ${sample.name} [${sample.pattern}]`);
  }
}

/** Random-name run. */
async function runHammer(cfg, patterns) {
  const client = buildClient(cfg.token);
  const startedAt = Date.now();

  const self = await fetchSelf(client);
  if (!self) {
    log('could not read account: token or network problem. stopping.');
    return 1;
  }

  const accountTag = self.discriminator && self.discriminator !== '0'
    ? `${self.username}#${self.discriminator}`
    : self.username;
  log(`mode: hammer | account: ${accountTag} (${self.id})`);
  log(`patterns: ${patterns.map((p) => p.label).join(' -> ')}`);

  const names = nameSequence(patterns);
  let attempts = 0;
  let lastCandidate = null;
  let lastPattern = null;
  let sameCandidateRetries = 0;

  for (;;) {
    if (cfg.maxAttempts > 0 && attempts >= cfg.maxAttempts) {
      log(`attempt ceiling reached (${cfg.maxAttempts}). stopping.`);
      await notify(cfg.webhookUrl, failureEmbed('Attempt ceiling reached.', attempts, lastCandidate));
      return 2;
    }

    let candidate;
    let patternLabel;
    if (sameCandidateRetries > 0) {
      candidate = lastCandidate;
      patternLabel = lastPattern;
    } else {
      const next = names.next().value;
      candidate = next.name;
      patternLabel = next.pattern;
    }
    lastCandidate = candidate;
    lastPattern = patternLabel;
    attempts += 1;

    let result;
    try {
      result = await updateUsername(client, candidate, cfg.password);
    } catch (err) {
      const plan = classifyError(err);
      log(`transport error on "${candidate}": ${plan.reason}`);
      await waitFor(plan.delayMs || cfg.attemptDelayMs);
      continue;
    }

    if (result.ok) {
      const elapsed = Date.now() - startedAt;
      log(`HIT: "${result.username}" [${patternLabel}] after ${attempts} attempt(s) in ${(elapsed / 1000).toFixed(1)}s`);
      await notify(cfg.webhookUrl, successEmbed(result.username, accountTag, attempts, elapsed, patternLabel));
      return 0;
    }

    const synthetic = { response: { status: result.status, headers: result.headers, data: result.body } };
    const plan = classifyError(synthetic);

    if (plan.action === 'fatal') {
      log(`stopped: ${plan.reason} (http ${result.status})`);
      const bodyMsg = result.body && result.body.message ? ` - ${result.body.message}` : '';
      await notify(cfg.webhookUrl, failureEmbed(`${plan.reason} (http ${result.status})${bodyMsg}`, attempts, candidate));
      return 3;
    }

    if (plan.action === 'retry-same') {
      sameCandidateRetries += 1;
      log(`rate limited on "${candidate}", waiting ${plan.delayMs}ms (retry ${sameCandidateRetries})`);
      await waitFor(plan.delayMs);
      continue;
    }

    sameCandidateRetries = 0;
    log(`"${candidate}" [${patternLabel}] unavailable (http ${result.status} ${plan.reason})`);
    await waitFor(plan.delayMs || cfg.attemptDelayMs);
  }
}

/**
 * Watch-list run. Polls each target, claims the first one that frees up.
 */
async function runWatch(cfg, list) {
  const client = buildClient(cfg.token);
  const startedAt = Date.now();

  const self = await fetchSelf(client);
  if (!self) {
    log('could not read account: token or network problem. stopping.');
    return 1;
  }

  const accountTag = self.discriminator && self.discriminator !== '0'
    ? `${self.username}#${self.discriminator}`
    : self.username;
  log(`mode: watch | account: ${accountTag} (${self.id})`);
  log(`targets: ${list.accepted.length} | interval: ${cfg.watchIntervalMs}ms`);

  let round = 0;
  let probes = 0;
  let claims = 0;

  for (;;) {
    round += 1;
    log(`round ${round}`);

    for (const name of list.accepted) {
      probes += 1;
      const verdict = await checkAvailability(client, name);

      if (verdict.state === 'taken') {
        log(`  ${name}: taken`);
        continue;
      }

      if (verdict.state === 'invalid') {
        log(`  ${name}: not allowed by the server, skipping`);
        continue;
      }

      if (verdict.state === 'unknown') {
        log(`  ${name}: probe inconclusive (${verdict.reason}), trying a claim anyway`);
      } else {
        log(`  ${name}: FREE, claiming`);
      }

      // Free, or the probe could not answer - take the shot.
      claims += 1;
      let result;
      try {
        result = await updateUsername(client, name, cfg.password);
      } catch (err) {
        const plan = classifyError(err);
        log(`  claim error on "${name}": ${plan.reason}`);
        await waitFor(plan.delayMs || cfg.attemptDelayMs);
        continue;
      }

      if (result.ok) {
        const elapsed = Date.now() - startedAt;
        log(`HIT: "${result.username}" claimed after ${claims} claim(s) in ${(elapsed / 1000).toFixed(1)}s`);
        await notify(cfg.webhookUrl, successEmbed(result.username, accountTag, claims, elapsed, 'watch'));
        return 0;
      }

      const synthetic = { response: { status: result.status, headers: result.headers, data: result.body } };
      const plan = classifyError(synthetic);

      if (plan.action === 'fatal') {
        log(`stopped: ${plan.reason} (http ${result.status})`);
        const bodyMsg = result.body && result.body.message ? ` - ${result.body.message}` : '';
        await notify(cfg.webhookUrl, failureEmbed(`${plan.reason} (http ${result.status})${bodyMsg}`, claims, name));
        return 3;
      }

      log(`  claim missed on "${name}" (http ${result.status} ${plan.reason})`);
      await waitFor(plan.delayMs || cfg.attemptDelayMs);
    }

    if (cfg.maxRounds > 0 && round >= cfg.maxRounds) {
      log(`round ceiling reached (${cfg.maxRounds}). ${probes} probe(s), ${claims} claim(s). stopping.`);
      await notify(cfg.webhookUrl, failureEmbed(`Round ceiling reached after ${probes} probe(s).`, claims, null));
      return 2;
    }

    log(`round ${round} done, sleeping ${cfg.watchIntervalMs}ms`);
    await sleep(cfg.watchIntervalMs);
  }
}

async function run() {
  const cfg = loadConfig();
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry');

  const mode = await pickMode(cfg);
  if (!mode) {
    log('menu closed, nothing to do.');
    return 0;
  }

  if (mode === 'watch') {
    const list = loadNames(cfg.watchFile);
    log(`watch list: ${list.path} (${list.accepted.length} usable)`);
    if (list.rejected.length > 0) {
      list.rejected.forEach((entry) => log(`skipped "${entry.name}": ${entry.why}`));
    }
    if (list.accepted.length === 0) {
      log('watch list has no usable names. stopping.');
      return 4;
    }
    if (dryRun) {
      preview(null, list);
      return 0;
    }
    return runWatch(cfg, list);
  }

  const patterns = await pickPatterns(cfg);
  if (dryRun) {
    preview(patterns, null);
    return 0;
  }
  return runHammer(cfg, patterns);
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