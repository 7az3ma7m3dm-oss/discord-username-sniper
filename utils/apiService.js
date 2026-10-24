'use strict';

const axios = require('axios');
const { log } = require('./utils');

const API_BASE = 'https://discord.com/api/v9';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/126.0.0.0 Safari/537.36';

function buildClient(token) {
  return axios.create({
    baseURL: API_BASE,
    timeout: 15000,
    headers: {
      Authorization: token,
      'Content-Type': 'application/json',
      'User-Agent': USER_AGENT,
      'X-Discord-Locale': 'en-US',
      'X-Debug-Options': 'bugReporterEnabled',
    },
    validateStatus: () => true,
  });
}

/**
 * Attempt to set the account username.
 * Returns { ok: true, username } or { ok: false, status, body, headers }.
 * Never throws on HTTP status; throws only on transport failure.
 */
async function updateUsername(client, username, password) {
  const res = await client.patch('/users/@me', { username, password });
  if (res.status === 200 && res.data && res.data.username) {
    return { ok: true, username: res.data.username, data: res.data };
  }
  return { ok: false, status: res.status, body: res.data, headers: res.headers };
}

/**
 * Send a webhook notification. Silent no-op when no URL is configured.
 * Webhook failures are logged and swallowed so they never stop the run.
 */
async function notify(webhookUrl, payload) {
  if (!webhookUrl) return;
  try {
    await axios.post(webhookUrl, payload, {
      timeout: 10000,
      headers: { 'Content-Type': 'application/json' },
      validateStatus: () => true,
    });
  } catch (err) {
    log(`webhook delivery failed: ${err.code || err.message}`);
  }
}

/** Standard embed for a successful change. */
function successEmbed(username, accountTag, attempts, elapsedMs, pattern) {
  return {
    username: 'username sniper',
    embeds: [
      {
        title: 'Hit confirmed',
        color: 0x57f287,
        description: `Username set to **${username}**`,
        fields: [
          { name: 'Pattern', value: pattern || 'n/a', inline: true },
          { name: 'Account', value: accountTag || 'unknown', inline: true },
          { name: 'Attempts', value: String(attempts), inline: true },
          { name: 'Elapsed', value: `${(elapsedMs / 1000).toFixed(1)}s`, inline: true },
        ],
        timestamp: new Date().toISOString(),
        footer: { text: '@oll.fx and killywilly' },
      },
    ],
  };
}

/** Standard embed for a stopped run. */
function failureEmbed(reason, attempts, lastCandidate) {
  return {
    username: 'username sniper',
    embeds: [
      {
        title: 'Run stopped',
        color: 0xed4245,
        description: reason,
        fields: [
          { name: 'Attempts', value: String(attempts), inline: true },
          { name: 'Last candidate', value: lastCandidate || 'none', inline: true },
        ],
        timestamp: new Date().toISOString(),
        footer: { text: '@oll.fx and killywilly' },
      },
    ],
  };
}

/** Fetch the current account tag for logging. Best effort only. */
async function fetchSelf(client) {
  try {
    const res = await client.get('/users/@me');
    if (res.status === 200 && res.data) {
      return {
        id: res.data.id,
        username: res.data.username,
        discriminator: res.data.discriminator,
      };
    }
  } catch (err) {
    log(`self lookup failed: ${err.code || err.message}`);
  }
  return null;
}

module.exports = {
  API_BASE,
  buildClient,
  updateUsername,
  notify,
  successEmbed,
  failureEmbed,
  fetchSelf,
};
