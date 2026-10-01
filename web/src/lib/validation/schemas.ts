import { z } from "zod";
import { parseKey } from "@/lib/domain/camelot";
import { parseTime } from "@/lib/domain/format";

const trimmed = (max: number) => z.string().trim().max(max, `Use at most ${max} characters.`);

const optionalNumber = (min: number, max: number, label: string) =>
  z
    .string()
    .trim()
    .transform((v, ctx) => {
      if (v === "") return null;
      const n = Number(v);
      if (!Number.isFinite(n) || n < min || n > max) {
        ctx.addIssue({ code: "custom", message: `${label} must be between ${min} and ${max}.` });
        return z.NEVER;
      }
      return n;
    });

const timeField = (label: string) =>
  z
    .string()
    .trim()
    .transform((v, ctx) => {
      const t = parseTime(v);
      if (t === null) {
        ctx.addIssue({ code: "custom", message: `${label} must look like 3:45 or a number of seconds.` });
        return z.NEVER;
      }
      return t;
    });

export const sourceEnum = z.enum(["estimate", "reviewed"]);
export const keyStatusEnum = z.enum(["unknown", "estimated", "reviewed", "uncertain", "not_meaningful"]);

export function splitList(value: string): string[] {
  return value
    .split(/[,|]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export const trackFormSchema = z
  .object({
    title: trimmed(300).min(1, "Enter a title."),
    artist: trimmed(300),
    version_label: trimmed(200),
    remix_group: trimmed(200),
    duration: timeField("Duration").refine((v) => v > 0 && v < 86400, "Duration must be positive."),
    style_tags: z.string().transform((v, ctx) => {
      const tags = [...new Set(splitList(v))];
      if (tags.length > 12 || tags.some((t) => t.length > 40)) {
        ctx.addIssue({ code: "custom", message: "Use up to 12 style tags of 40 characters or fewer." });
        return z.NEVER;
      }
      return tags;
    }),
    bpm: optionalNumber(40, 250, "BPM"),
    bpm_alternatives: z.string().transform((v, ctx) => {
      const values = splitList(v).map(Number);
      if (values.length > 4 || values.some((n) => !Number.isFinite(n) || n < 40 || n > 250)) {
        ctx.addIssue({ code: "custom", message: "List up to 4 alternative BPMs between 40 and 250." });
        return z.NEVER;
      }
      return values;
    }),
    bpm_source: sourceEnum,
    key: z.string().trim().max(20),
    key_status: keyStatusEnum,
    energy: optionalNumber(1, 10, "Energy"),
    energy_source: sourceEnum,
    asset_id: trimmed(128),
    feature_id: trimmed(128),
    notes: trimmed(4000),
  })
  .transform((v, ctx) => {
    let keyTonic: number | null = null;
    let keyMode: "major" | "minor" | null = null;
    let keyStatus = v.key_status;
    if (v.key !== "") {
      const parsed = parseKey(v.key);
      if (!parsed) {
        ctx.addIssue({ code: "custom", path: ["key"], message: "Use a Camelot code (8A) or a key name (A minor, C#m)." });
        return z.NEVER;
      }
      keyTonic = parsed.tonic;
      keyMode = parsed.mode;
      if (keyStatus === "unknown" || keyStatus === "not_meaningful") keyStatus = "reviewed";
    } else if (keyStatus === "estimated" || keyStatus === "reviewed") {
      keyStatus = "unknown";
    }
    return {
      title: v.title,
      artist: v.artist,
      version_label: v.version_label,
      remix_group: v.remix_group,
      duration_seconds: v.duration,
      style_tags: v.style_tags,
      bpm: v.bpm,
      bpm_alternatives: v.bpm_alternatives,
      bpm_source: v.bpm === null ? null : v.bpm_source,
      key_tonic: keyTonic,
      key_mode: keyMode,
      key_status: keyStatus,
      energy: v.energy,
      energy_source: v.energy === null ? null : v.energy_source,
      asset_id: v.asset_id || null,
      feature_id: v.feature_id || null,
      notes: v.notes,
    };
  });

export type TrackInsert = z.output<typeof trackFormSchema>;

export const cueFormSchema = z
  .object({
    kind: z.enum(["entry", "exit"]),
    start: timeField("Start"),
    end: timeField("End"),
    label: trimmed(120),
    provenance: sourceEnum,
    review_status: z.enum(["pending", "approved", "rejected"]),
    vocal_activity: z.enum(["unknown", "none", "present"]),
  })
  .refine((v) => v.end > v.start, { path: ["end"], message: "The region must end after it starts." });

export const crateFormSchema = z.object({
  name: trimmed(120).min(1, "Enter a crate name."),
  description: trimmed(2000),
});

export const uuidSchema = z.uuid();

export function isUuid(value: string): boolean {
  return uuidSchema.safeParse(value).success;
}

export type FieldErrors = Record<string, string>;

export function fieldErrors(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "form";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

export interface ActionState {
  ok: boolean;
  message: string;
  fieldErrors?: FieldErrors;
}

export const initialActionState: ActionState = { ok: false, message: "" };
