import { Hono } from "hono";
import { Container } from "@cloudflare/containers";
import type { Env } from "./types";
import { geminiChat } from "./gemini";

// ✅ 必须导出：名字要和 wrangler 里 durable object 的 class_name 一致（MyContainer）
export class MyContainer extends Container {
  // 先用 8080；如果你的容器服务监听别的端口（如 3000/8787），再改这里
  defaultPort = 8080;
}

const app = new Hono<{ Bindings: Env }>();

app.get("/health", (c) =>
  c.json({ ok: true, service: "openclaw-container", ts: new Date().toISOString() })
);

// Telegram Webhook endpoint alive check
app.options("/telegram/webhook", (c) => c.json({ ok: true }));
app.get("/telegram/webhook", (c) =>
  c.json({ ok: true, hint: "Telegram webhook endpoint is alive. Telegram will POST updates here." })
);

// 兼容：如果误把 webhook 设为 /telegram，给出明确提示（不要在这里消费 body）
app.post("/telegram", async (c) => {
  console.log("[telegram] Received POST /telegram (wrong path). Fix webhook to /telegram/webhook.");
  return c.json(
    { ok: false, error: "wrong_webhook_path", fix: "Set webhook url to /telegram/webhook" },
    400
  );
});

app.post("/telegram/webhook", async (c) => {
  console.log("[telegram] webhook hit", { method: c.req.method, url: c.req.url });

  const secret = c.env.TELEGRAM_WEBHOOK_SECRET;
  if (secret) {
    const got = c.req.header("x-telegram-bot-api-secret-token") || "";
    if (got !== secret) {
      console.log("[telegram] forbidden: secret mismatch");
      return c.text("forbidden", 403);
    }
  }

  const update: any = await c.req.json().catch(() => ({}));
  const msg = update?.message || update?.edited_message;
  const chatId = msg?.chat?.id;
  const text = msg?.text;

  if (!chatId) {
    return c.json({ ok: true, ignored: "no chat id" });
  }

  if (!text || typeof text !== "string") {
    await telegramSendMessage(c.env.TELEGRAM_BOT_TOKEN, chatId, "目前只处理文本消息。");
    return c.json({ ok: true });
  }

  const userText = text.trim();

  if (userText === "/start") {
    await telegramSendMessage(c.env.TELEGRAM_BOT_TOKEN, chatId, "✅ OpenClaw 已连接。直接发消息给我即可。");
    return c.json({ ok: true });
  }

  if (userText.toLowerCase() === "ping") {
    await telegramSendMessage(c.env.TELEGRAM_BOT_TOKEN, chatId, "pong ✅");
    return c.json({ ok: true });
  }

  try {
    const reply = await geminiChat(c.env, userText);
    await telegramSendMessage(c.env.TELEGRAM_BOT_TOKEN, chatId, reply);
  } catch (e: any) {
    console.log("[telegram] handler error", e?.message || String(e));
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
