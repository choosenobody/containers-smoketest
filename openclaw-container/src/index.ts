import { Hono } from "hono";
import type { Env } from "./types";
import { geminiChat } from "./gemini";

const app = new Hono<{ Bindings: Env }>();

app.get("/health", (c) => c.json({ ok: true, service: "openclaw-container", ts: new Date().toISOString() }));

/**
 * Telegram Webhook
 * - 为了简单，默认用 path = /telegram/webhook
 * - 你可以在 wrangler.toml 里改 TELEGRAM_WEBHOOK_PATH
 * - 可选：如果你设置了 TELEGRAM_WEBHOOK_SECRET，则会检查 header: X-Telegram-Bot-Api-Secret-Token
 */
app.post("*", async (c, next) => {
  const hookPath = c.env.TELEGRAM_WEBHOOK_PATH || "/telegram/webhook";
  const url = new URL(c.req.url);
  if (url.pathname === hookPath) return next();
  return c.text("not found", 404);
});

app.post("/telegram/webhook", async (c) => {
  const secret = c.env.TELEGRAM_WEBHOOK_SECRET;
  if (secret) {
    const got = c.req.header("x-telegram-bot-api-secret-token") || "";
    if (got !== secret) return c.text("forbidden", 403);
  }

  const update: any = await c.req.json().catch(() => ({}));
  const msg = update?.message || update?.edited_message;
  const chatId = msg?.chat?.id;
  const text = msg?.text;

  if (!chatId) return c.json({ ok: true, ignored: "no chat id" });
  if (!text || typeof text !== "string") {
    await telegramSendMessage(c.env.TELEGRAM_BOT_TOKEN, chatId, "目前只处理文本消息。");
    return c.json({ ok: true });
  }

  // 过滤 /start 之类命令
  const userText = text.trim();
  if (userText === "/start") {
    await telegramSendMessage(c.env.TELEGRAM_BOT_TOKEN, chatId, "✅ OpenClaw 已连接。直接发消息给我即可。");
    return c.json({ ok: true });
  }

  try {
    const reply = await geminiChat(c.env, userText);
    await telegramSendMessage(c.env.TELEGRAM_BOT_TOKEN, chatId, reply);
  } catch (e: any) {
    await telegramSendMessage(c.env.TELEGRAM_BOT_TOKEN, chatId, `❌ 出错：${e?.message || String(e)}`);
  }

  return c.json({ ok: true });
});

async function telegramSendMessage(token: string, chatId: number | string, text: string) {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const body = { chat_id: chatId, text };
  const resp = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error(`telegram sendMessage failed: ${resp.status} ${resp.statusText} :: ${t.slice(0, 200)}`);
  }
}

export default app;
