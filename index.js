'use strict';

const { loadConfig, log, sleep } = require('./utils/utils');
const { nameSequence, parsePatternList } = require('./utils/nameGenerator');
const { askPatterns } = require('./utils/menu');
const { classifyError, waitFor } = require('./utils/errorHandling');
const {
  buildClient,
  updateUsername,
  notify,
  successEmbed,
  failureEmbed,
  fetchSelf,
} = require('./utils/apiService');

/** Work out which patterns to run, from CLI first, then config. */
function resolvePatterns(cfg) {
  const fromCli = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  if (fromCli.length > 0) return parsePatternList(fromCli.join(' '));

  if (Array.isArray(cfg.namePatterns) && cfg.namePatterns.length > 0) {
    return parsePatternList(cfg.namePatterns.join(' '));
  }

  if (cfg.namePattern) return parsePatternList(cfg.namePattern);

  // Legacy fallback: nameLength + useLettersOnly
  return parsePatternList([`${cfg.nameLength}${cfg.useLettersOnly ? 'l' : 'c'}`]);
}

/** Decide patterns: CLI arg > menu (when run bare) > config. */
async function pickPatterns(cfg) {
  const args = process.argv.slice(2);
  const hasCliPattern = args.some((a) => !a.startsWith('--'));
  const noMenu = args.includes('--no-menu');

  if (hasCliPattern) return resolvePatterns(cfg);
  if (noMenu || cfg.menu === false) return resolvePatterns(cfg);
  return askPatterns();
}

async function run() {
  const cfg = loadConfig();
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry');
  const patterns = await pickPatterns(cfg);

  if (dryRun) {
    const names = nameSequence(patterns);
    log(`dry run - patterns: ${patterns.map((p) => p.label).join(' -> ')}`);
    for (let i = 0; i < 8; i += 1) {
      const sample = names.next().value;
      log(`sample ${i + 1}: ${sample.name} [${sample.pattern}]`);
    }
    return 0;
  }

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
  log(`account: ${accountTag} (${self.id})`);
  log(`current username: ${self.username}`);
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
      log(
        `HIT: username set to "${result.username}" (${patternLabel}) after ${attempts} attempt(s) in ${(elapsed / 1000).toFixed(1)}s`,
      );
      await notify(cfg.webhookUrl, successEmbed(result.username, accountTag, attempts, elapsed, patternLabel));
      if (cfg.stopOnSuccess) return 0;
      sameCandidateRetries = 0;
      await sleep(cfg.attemptDelayMs);
      continue;
    }

    const synthetic = { response: { status: result.status, headers: result.headers, data: result.body } };
    const plan = classifyError(synthetic);

    if (plan.action === 'fatal') {
      log(`stopped: ${plan.reason} (http ${result.status})`);
      const bodyMsg = result.body && result.body.message ? ` - ${result.body.message}` : '';
      await notify(
        cfg.webhookUrl,
        failureEmbed(`${plan.reason} (http ${result.status})${bodyMsg}`, attempts, candidate),
      );
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

if (require.main === module) {
  run()
    .then((code) => process.exit(code))
    .catch((err) => {
      log(`unhandled: ${err && err.stack ? err.stack : err}`);
      process.exit(1);
    });
}

module.exports = { run, resolvePatterns, pickPatterns };
