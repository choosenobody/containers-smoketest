# openclaw-container (最小可跑版本)

目标：先把 Telegram Bot 跑通（能收到消息、调用 Gemini、回消息），再逐步把 Moltbot/OpenClaw 的完整能力搬进来。

## 你需要在 GitHub Repo -> Settings -> Secrets and variables -> Actions 里加 4 个 Secrets

- CLOUDFLARE_API_TOKEN
- CLOUDFLARE_ACCOUNT_ID
- TELEGRAM_BOT_TOKEN
- GEMINI_API_KEY

可选（强烈建议）：
- TELEGRAM_WEBHOOK_SECRET （任意随机字符串，用于校验 Telegram webhook 请求）

## 部署方式（CI-only）

1) GitHub Actions 里手动触发：`Deploy openclaw-container (Worker)`
2) Workflow 会自动部署，并自动调用 Telegram `setWebhook` 指向你部署出来的 URL + `/telegram/webhook`
3) 去 Telegram 给你的 bot 发 `/start`，应返回 “OpenClaw 已连接...”
4) 再随便发一句话，bot 应回 Gemini 的回答

## 常见故障

- “发消息没反应”：90% 是 webhook 没绑上。去 Telegram 里执行 getWebhookInfo 看下。
- “403 forbidden”：你设置了 TELEGRAM_WEBHOOK_SECRET，但 Telegram 没带 secret_token（通常是 setWebhook 没成功）。
- “Gemini call failed”：检查 AI_GATEWAY_BASE_URL 是否正确、GEMINI_API_KEY 是否可用。
