import type { Env } from "./types";

/**
 * 通过 Cloudflare AI Gateway (google-ai-studio) 调用 Gemini generateContent
 * 你给的 baseUrl 末尾是 /google-ai-studio，所以后面的路径要跟 Google AI Studio 一致。
 */
export async function geminiChat(env: Env, userText: string): Promise<string> {
  const model = env.GEMINI_MODEL || "gemini-1.5-pro-latest";
  const url = `${env.AI_GATEWAY_BASE_URL}/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`;

  const body = {
    contents: [{ role: "user", parts: [{ text: userText }] }],
    generationConfig: { temperature: 0.6 }
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error(`Gemini call failed: ${resp.status} ${resp.statusText} :: ${t.slice(0, 300)}`);
  }

  const data: any = await resp.json();
  const text =
    data?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text).filter(Boolean).join("") ||
    data?.candidates?.[0]?.content?.parts?.[0]?.text ||
    "";

  return (text || "").trim() || "（模型没有返回文本）";
}
