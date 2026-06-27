// Direct fetch() calls to the Anthropic Messages API — no SDK needed, keeps
// this dependency-free for the Cloudflare Worker runtime.
//
// IMPORTANT: read the API key inside the function body, not at module scope.
// Reading process.env at module scope can get inlined into the client bundle
// and is unreliable under Worker SSR. See TanStack Start's execution-model docs.

const MODEL = "claude-sonnet-4-6";
const ANTHROPIC_VERSION = "2023-06-01";

function getAnthropicKey(): string {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Add it as a server secret in your deployment settings.",
    );
  }
  return key;
}

interface AnthropicTextBlock {
  type: "text";
  text: string;
}

interface AnthropicMessageResponse {
  content: AnthropicTextBlock[];
}

/** Send a single-turn prompt to Claude and return the text response. */
export async function askClaude(prompt: string, maxTokens = 800): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": getAnthropicKey(),
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Claude API error ${res.status}: ${body.slice(0, 300)}`);
  }

  const json = (await res.json()) as AnthropicMessageResponse;
  const block = json.content.find((c) => c.type === "text");
  return (block?.text ?? "").trim();
}

/**
 * Parse JSON out of a Claude response that may be wrapped in ```json fences,
 * have prose before/after, or otherwise not be pure JSON. Returns null on
 * failure instead of throwing — callers decide the fallback.
 */
export function parseClaudeJson<T = unknown>(raw: string): T | null {
  if (!raw) return null;
  let text = raw.trim();
  text = text.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    text = text.slice(start, end + 1);
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}
