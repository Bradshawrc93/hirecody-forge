import { haikuJSON } from "./anthropic";

const GUARDRAIL_PROMPT = `You are helping classify a user's agent description for a lightweight automation platform. The platform supports: LLM calls (text generation, summarization, classification, extraction, research with web search), web fetching (public URLs, news, articles, RSS), file processing (.csv and .md — reading, transforming, generating), email sending (to a single verified address), and scheduled execution (daily/weekly/monthly).

Be generous. Default to "simple" or "moderate". Things like "daily news digest", "weekly summary of X", "monitor a page and email me changes", or "generate content on a schedule" are all well within scope — they do not require external API keys, state, or long-running processes. Only mark something "complex" if it genuinely cannot work: requires authenticating to a third-party service the user would need to provide credentials for, requires image/video/audio processing, requires sub-minute real-time streaming, or requires interacting with desktop apps.

Even when you mark something "complex", the user will still be allowed to proceed — your job is informational, not gatekeeping. The "reason" should be a friendly, encouraging nudge (not a rejection), suggesting how they might narrow scope if they run into trouble.

Respond with ONLY a JSON object:
{
  "feasibility": "simple" | "moderate" | "complex",
  "needs_llm": "unlikely" | "maybe" | "likely",
  "suggested_input": "none" | "text" | "file" | "both",
  "reason": "one short friendly sentence if complex"
}`;

const SAFETY_PROMPT = `You are a content moderation classifier for a public agent playground. Your job is to flag agent display names and descriptions that contain profanity, hate speech, sexual content, or harassment. Be lenient with weird/creative ideas — only flag actual abuse.

Respond with ONLY a JSON object:
{
  "safe": true | false,
  "reason": "one sentence if not safe"
}`;

export interface GuardrailResult {
  feasibility: "simple" | "moderate" | "complex";
  needs_llm: "unlikely" | "maybe" | "likely";
  suggested_input: "none" | "text" | "file" | "both";
  reason?: string;
}

export interface SafetyResult {
  safe: boolean;
  reason?: string;
}

export async function complexityCheck(description: string): Promise<GuardrailResult> {
  const { data } = await haikuJSON<GuardrailResult>(
    GUARDRAIL_PROMPT,
    `User's agent description: "${description}"`
  );
  return data;
}

export async function safetyCheck(
  displayName: string,
  description: string
): Promise<SafetyResult> {
  const { data } = await haikuJSON<SafetyResult>(
    SAFETY_PROMPT,
    `Display name: "${displayName}"\nDescription: "${description}"`
  );
  return data;
}
