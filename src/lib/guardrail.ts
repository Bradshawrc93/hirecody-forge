import { haikuJSON } from "./anthropic";

const GUARDRAIL_PROMPT = `You are evaluating whether a user's agent description is feasible for a lightweight automation platform. The platform supports: single-purpose agents with 1-5 steps, LLM calls (text generation, summarization, classification, extraction), web fetching (GET requests to public URLs), file processing (.csv and .md files — reading, transforming, generating), email sending (to a single verified address), and scheduled execution (daily/weekly/monthly).

The platform does NOT support: multi-system orchestration requiring authentication to external services (other than the provided email), database connections, long-running processes (over 2 minutes), agents that need to maintain state across runs, real-time monitoring or streaming data, image/video/audio processing, or interactions with desktop applications.

Evaluate the description and respond with ONLY a JSON object:
{
  "feasibility": "simple" | "moderate" | "complex",
  "needs_llm": "unlikely" | "maybe" | "likely",
  "suggested_input": "none" | "text" | "file" | "both",
  "reason": "one sentence explanation if complex"
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
