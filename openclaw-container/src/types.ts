export interface Env {
  // Telegram
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET?: string;

  // Gemini via Cloudflare AI Gateway (google-ai-studio)
  GEMINI_API_KEY: string;
  AI_GATEWAY_BASE_URL: string;
  GEMINI_MODEL?: string;
}
