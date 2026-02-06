/**
 * Moltbot + Cloudflare Sandbox
 *
 * This Worker runs Moltbot personal AI assistant in a Cloudflare Sandbox container.
 * It proxies all requests to the Moltbot Gateway's web UI and WebSocket endpoint.
 */

import { Hono } from 'hono';
import { getSandbox, Sandbox, type SandboxOptions } from '@cloudflare/sandbox';

import type { AppEnv, MoltbotEnv } from './types';
import { MOLTBOT_PORT } from './config';
import { createAccessMiddleware } from './auth';
import { ensureMoltbotGateway, findExistingMoltbotProcess, syncToR2 } from './gateway';
import { publicRoutes, api, adminUi, debug, cdp } from './routes';
import { redactSensitiveParams } from './utils/logging';
import loadingPageHtml from './assets/loading.html';
import configErrorHtml from './assets/config-error.html';

export { Sandbox };

function validateRequiredEnv(env: MoltbotEnv): string[] {
  const missing: string[] = [];
  const isTestMode = env.DEV_MODE === 'true' || env.E2E_TEST_MODE === 'true';

  if (!env.MOLTBOT_GATEWAY_TOKEN) missing.push('MOLTBOT_GATEWAY_TOKEN');

  if (!isTestMode) {
    if (!env.CF_ACCESS_TEAM_DOMAIN) missing.push('CF_ACCESS_TEAM_DOMAIN');
    if (!env.CF_ACCESS_AUD) missing.push('CF_ACCESS_AUD');
  }

  if (env.AI_GATEWAY_API_KEY) {
    if (!env.AI_GATEWAY_BASE_URL) {
      missing.push('AI_GATEWAY_BASE_URL (required when using AI_GATEWAY_API_KEY)');
    }
  } else if (!env.ANTHROPIC_API_KEY) {
    missing.push('ANTHROPIC_API_KEY or AI_GATEWAY_API_KEY');
  }

  return missing;
}

function buildSandboxOptions(env: MoltbotEnv): SandboxOptions {
  const sleepAfter = env.SANDBOX_SLEEP_AFTER?.toLowerCase() || 'never';
  if (sleepAfter === 'never') return { keepAlive: true };
  return { sleepAfter };
}

const app = new Hono<AppEnv>();

// -----------------------------------------------------------------------------
// Logging
// -----------------------------------------------------------------------------
app.use('*', async (c, next) => {
  const url = new URL(c.req.url);
  console.log(`[REQ] ${c.req.method} ${url.pathname}${redactSensitiveParams(url)}`);
  await next();
});

// -----------------------------------------------------------------------------
// Sandbox init
// -----------------------------------------------------------------------------
app.use('*', async (c, next) => {
  const sandbox = getSandbox(c.env.Sandbox, 'moltbot', buildSandboxOptions(c.env));
  c.set('sandbox', sandbox);
  await next();
});

// -----------------------------------------------------------------------------
// Public routes
// -----------------------------------------------------------------------------
app.route('/', publicRoutes);
app.route('/cdp', cdp);

// -----------------------------------------------------------------------------
// ENV validation (skip in DEV)
// -----------------------------------------------------------------------------
app.use('*', async (c, next) => {
  if (c.env.DEV_MODE === 'true') return next();
  if (new URL(c.req.url).pathname.startsWith('/debug')) return next();

  const missing = validateRequiredEnv(c.env);
  if (missing.length === 0) return next();

  const acceptsHtml = c.req.header('Accept')?.includes('text/html');
  if (acceptsHtml) {
    return c.html(
      configErrorHtml.replace('{{MISSING_VARS}}', missing.join(', ')),
      503
    );
  }

  return c.json(
    { error: 'Missing env vars', missing },
    503
  );
});

// -----------------------------------------------------------------------------
// 🔑 Cloudflare Access middleware
// ✅ Telegram webhook bypass (THIS IS THE FIX)
// -----------------------------------------------------------------------------
app.use('*', async (c, next) => {
  const method = c.req.method.toUpperCase();
  const ua = c.req.header('User-Agent') || '';

  // ✅ Allow Telegram webhooks through (they cannot send CF Access tokens)
  if (method === 'POST' && ua.includes('TelegramBot')) {
    return next();
  }

  const acceptsHtml = c.req.header('Accept')?.includes('text/html');
  const middleware = createAccessMiddleware({
    type: acceptsHtml ? 'html' : 'json',
    redirectOnMissing: acceptsHtml,
  });

  return middleware(c, next);
});

// -----------------------------------------------------------------------------
// Protected routes
// -----------------------------------------------------------------------------
app.route('/api', api);
app.route('/_admin', adminUi);

app.use('/debug/*', async (c, next) => {
  if (c.env.DEBUG_ROUTES !== 'true') {
    return c.json({ error: 'Debug routes disabled' }, 404);
  }
  return next();
});
app.route('/debug', debug);

// -----------------------------------------------------------------------------
// Catch-all → proxy to Moltbot gateway
// -----------------------------------------------------------------------------
app.all('*', async (c) => {
  const sandbox = c.get('sandbox');
  const req = c.req.raw;
  const url = new URL(req.url);

  const existing = await findExistingMoltbotProcess(sandbox);
  const ready = existing && existing.status === 'running';

  const isWs = req.headers.get('Upgrade')?.toLowerCase() === 'websocket';
  const acceptsHtml = req.headers.get('Accept')?.includes('text/html');

  if (!ready && !isWs && acceptsHtml) {
    c.executionCtx.waitUntil(
      ensureMoltbotGateway(sandbox, c.env).catch(console.error)
    );
    return c.html(loadingPageHtml);
  }

  await ensureMoltbotGateway(sandbox, c.env);

  if (isWs) {
    return sandbox.wsConnect(req, MOLTBOT_PORT);
  }

  return sandbox.containerFetch(req, MOLTBOT_PORT);
});

// -----------------------------------------------------------------------------
// Cron backup
// -----------------------------------------------------------------------------
async function scheduled(
  _event: ScheduledEvent,
  env: MoltbotEnv
): Promise<void> {
  const sandbox = getSandbox(env.Sandbox, 'moltbot', buildSandboxOptions(env));
  await syncToR2(sandbox, env);
}

export default {
  fetch: app.fetch,
  scheduled,
};
