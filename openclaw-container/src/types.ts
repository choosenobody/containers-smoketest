export interface Env {
  // Telegram
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET?: string; // 可选：用来校验 Telegram 请求（我们会用 header 校验）

  // Gemini via Cloudflare AI Gateway (google-ai-studio provider)
  GEMINI_API_KEY: string;
  AI_GATEWAY_BASE_URL: string;
  GEMINI_MODEL?: string;

  // Optional: protect webhook path
  TELEGRAM_WEBHOOK_PATH?: string;
}
