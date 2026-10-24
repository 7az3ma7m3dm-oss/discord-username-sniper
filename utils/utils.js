'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Read and validate config.json from project root.
 * Throws on missing file or missing required keys so the run fails
 * before touching the network.
 */
function loadConfig() {
  const configPath = path.join(__dirname, '..', 'config.json');
  if (!fs.existsSync(configPath)) {
    throw new Error(`config.json not found at ${configPath}`);
  }
  const raw = fs.readFileSync(configPath, 'utf8');
  let cfg;
  try {
    cfg = JSON.parse(raw);
  } catch (err) {
    throw new Error(`config.json is not valid JSON: ${err.message}`);
  }

  const required = ['token', 'password'];
  for (const key of required) {
    if (!cfg[key] || typeof cfg[key] !== 'string' || cfg[key].startsWith('YOUR_')) {
      throw new Error(`config.json: "${key}" is missing or still a placeholder`);
    }
  }

  return {
    webhookUrl: cfg.webhookUrl && !cfg.webhookUrl.includes('CHANGEME') ? cfg.webhookUrl : null,
    token: cfg.token,
    password: cfg.password,
    namePatterns: Array.isArray(cfg.namePatterns)
      ? cfg.namePatterns.filter((p) => typeof p === 'string' && p.trim() !== '')
      : null,
    namePattern: typeof cfg.namePattern === 'string' ? cfg.namePattern : null,
    menu: cfg.menu !== false,
    mode: typeof cfg.mode === 'string' ? cfg.mode : 'hammer',
    watchFile: typeof cfg.watchFile === 'string' ? cfg.watchFile : 'names.txt',
    watchIntervalMs: Number.isInteger(cfg.watchIntervalMs) ? cfg.watchIntervalMs : 30000,
    maxRounds: Number.isInteger(cfg.maxRounds) ? cfg.maxRounds : 0,
    probeConcurrency: Number.isInteger(cfg.probeConcurrency) ? cfg.probeConcurrency : 8,
    batchDelayMs: Number.isInteger(cfg.batchDelayMs) ? cfg.batchDelayMs : 150,
    scanCount: Number.isInteger(cfg.scanCount) ? cfg.scanCount : 50,
    claimOnFree: cfg.claimOnFree !== false,
    saveResults: cfg.saveResults !== false,
    availableFile: typeof cfg.availableFile === 'string' ? cfg.availableFile : 'available.txt',
    nameLength: Number.isInteger(cfg.nameLength) ? cfg.nameLength : 3,
    useLettersOnly: cfg.useLettersOnly !== false,
    attemptDelayMs: Number.isInteger(cfg.attemptDelayMs) ? cfg.attemptDelayMs : 1100,
    maxAttempts: Number.isInteger(cfg.maxAttempts) ? cfg.maxAttempts : 0,
    stopOnSuccess: cfg.stopOnSuccess !== false,
  };
}

/** Timestamped log line so long runs stay readable. */
function log(message) {
  const stamp = new Date().toISOString();
  console.log(`[${stamp}] ${message}`);
}

/** Promise-based sleep. */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Parse Retry-After / X-RateLimit-Reset headers into milliseconds. */
function retryAfterMs(headers, fallbackMs) {
  if (!headers) return fallbackMs;

  const retryAfter = headers['retry-after'];
  if (retryAfter !== undefined) {
    const seconds = parseFloat(retryAfter);
    if (!Number.isNaN(seconds)) return Math.ceil(seconds * 1000);
  }

  const reset = headers['x-ratelimit-reset'];
  if (reset !== undefined) {
    const resetSeconds = parseFloat(reset);
    if (!Number.isNaN(resetSeconds)) {
      const delta = resetSeconds * 1000 - Date.now();
      if (delta > 0) return Math.ceil(delta);
    }
  }

  return fallbackMs;
}

module.exports = { loadConfig, log, sleep, retryAfterMs };
