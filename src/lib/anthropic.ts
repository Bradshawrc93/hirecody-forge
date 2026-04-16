import Anthropic from "@anthropic-ai/sdk";

let client: Anthropic | null = null;

export function anthropic(): Anthropic {
  if (!client) {
    client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      timeout: 90_000,
      maxRetries: 1,
    });
  }
  return client;
}

export const BUILDER_MODEL = "claude-sonnet-4-6";
export const HAIKU_MODEL = "claude-haiku-4-5";

export async function haikuJSON<T = unknown>(
  systemPrompt: string,
  userPrompt: string
): Promise<{ data: T; inputTokens: number; outputTokens: number }> {
  const res = await anthropic().messages.create({
    model: HAIKU_MODEL,
    max_tokens: 512,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });
  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("haiku: no JSON in response");
  const data = JSON.parse(match[0]) as T;
  return {
    data,
    inputTokens: res.usage.input_tokens,
    outputTokens: res.usage.output_tokens,
  };
}
