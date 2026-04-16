export interface FormState {
  // Step 1
  display_name: string;
  slug: string;
  description: string;
  // Step 2
  needs_llm: boolean;
  model: string;
  input_type: "none" | "text" | "file" | "both";
  can_send_email: boolean;
  has_web_access: boolean;
  schedule_cadence: "daily" | "weekly" | "monthly" | null;
  schedule_time: string | null; // HH:MM:00 UTC
  schedule_day_of_week: number | null;
  schedule_day_of_month: number | null;
  verified_email: string | null;
  // Step 3
  success_criteria: string;
  output_type: "text" | "file" | "email" | "notification" | "side-effect";
  context_text: string;
}

export const DEFAULT_FORM: FormState = {
  display_name: "",
  slug: "",
  description: "",
  needs_llm: true,
  model: "claude-sonnet-4-6",
  input_type: "none",
  can_send_email: false,
  has_web_access: true,
  schedule_cadence: null,
  schedule_time: null,
  schedule_day_of_week: null,
  schedule_day_of_month: null,
  verified_email: null,
  success_criteria: "",
  output_type: "text",
  context_text: "",
};

export const RUNTIME_MODELS = [
  { id: "claude-opus-4-6", label: "Claude Opus 4.6" },
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
  { id: "gpt-4o", label: "GPT-4o" },
  { id: "gpt-4o-mini", label: "GPT-4o mini" },
  { id: "gpt-4-turbo", label: "GPT-4 Turbo" },
];
