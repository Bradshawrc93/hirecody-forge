export interface InputTypeConfig {
  enabled: boolean;
  label?: string;
}

export interface TextInputConfig extends InputTypeConfig {
  size: "short" | "long";
}

export interface FileSlot {
  label: string;
  required: boolean;
}

export interface FileInputConfig {
  enabled: boolean;
  slots: FileSlot[];
}

export const MAX_FILE_SLOTS = 5;

export interface InputConfig {
  text: TextInputConfig;
  url: InputTypeConfig;
  file: FileInputConfig;
}

export const DEFAULT_INPUT_CONFIG: InputConfig = {
  text: { enabled: false, size: "short" },
  url: { enabled: false },
  file: { enabled: false, slots: [] },
};

export type LegacyInputType = "none" | "text" | "file" | "both";

// Older agents (or Obs returning the legacy input_type) have no slot info.
// Produce a single required unnamed slot so the UI has something to render.
function defaultFileSlots(): FileSlot[] {
  return [{ label: "", required: true }];
}

export function legacyInputTypeToConfig(input_type: LegacyInputType): InputConfig {
  switch (input_type) {
    case "text":
      return {
        text: { enabled: true, size: "short" },
        url: { enabled: false },
        file: { enabled: false, slots: [] },
      };
    case "file":
      return {
        text: { enabled: false, size: "short" },
        url: { enabled: false },
        file: { enabled: true, slots: defaultFileSlots() },
      };
    case "both":
      return {
        text: { enabled: true, size: "short" },
        url: { enabled: false },
        file: { enabled: true, slots: defaultFileSlots() },
      };
    default:
      return { ...DEFAULT_INPUT_CONFIG, file: { enabled: false, slots: [] } };
  }
}

export function inputConfigToLegacy(config: InputConfig): LegacyInputType {
  const t = config.text.enabled;
  const f = config.file.enabled;
  if (t && f) return "both";
  if (t) return "text";
  if (f) return "file";
  return "none";
}

// Normalize a possibly-stale file input config (older shape with a single
// `label` string) into the new slots array. Safe to call on already-new
// configs; idempotent.
type LegacyFileShape = {
  enabled?: boolean;
  label?: string;
  slots?: FileSlot[];
};

export function legacyFileConfigToSlots(file: LegacyFileShape | undefined): FileInputConfig {
  if (!file) return { enabled: false, slots: [] };
  if (Array.isArray(file.slots)) {
    return {
      enabled: !!file.enabled,
      slots: file.slots.map((s) => ({
        label: typeof s?.label === "string" ? s.label : "",
        required: s?.required !== false,
      })),
    };
  }
  // Old shape: { enabled, label? }
  if (file.enabled) {
    return {
      enabled: true,
      slots: [{ label: file.label ?? "", required: true }],
    };
  }
  return { enabled: false, slots: [] };
}

// Normalize any InputConfig blob (from Obs, from the builder, from clone
// session storage) to the current shape. Idempotent.
export function normalizeInputConfig(raw: unknown): InputConfig {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_INPUT_CONFIG };
  const r = raw as Partial<InputConfig> & { file?: LegacyFileShape };
  return {
    text: {
      enabled: !!r.text?.enabled,
      size: r.text?.size === "long" ? "long" : "short",
      label: r.text?.label,
    },
    url: {
      enabled: !!r.url?.enabled,
      label: r.url?.label,
    },
    file: legacyFileConfigToSlots(r.file),
  };
}

export interface FormState {
  // Step 1
  display_name: string;
  slug: string;
  description: string;
  // Step 2
  needs_llm: boolean;
  model: string;
  input_config: InputConfig;
  can_send_email: boolean;
  has_web_access: boolean;
  schedule_cadence: "daily" | "weekly" | "monthly" | null;
  schedule_time: string | null; // HH:MM:00 UTC
  schedule_day_of_week: number | null;
  schedule_day_of_month: number | null;
  verified_email: string | null;
  // Step 3
  success_criteria: string;
  output_type: "text" | "file" | "email" | "notification" | "html_report" | "csv" | "side-effect";
  context_text: string;
}

export const DEFAULT_FORM: FormState = {
  display_name: "",
  slug: "",
  description: "",
  needs_llm: true,
  model: "claude-sonnet-4-6",
  input_config: { ...DEFAULT_INPUT_CONFIG },
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
