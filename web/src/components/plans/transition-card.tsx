"use client";

import { ArrowDown } from "lucide-react";
import { useActionState } from "react";
import { judgeTransition } from "@/app/actions/plans";
import { ActionForm } from "@/components/app/action-form";
import { FormMessage } from "@/components/app/form-message";
import { StatusBadge } from "@/components/app/status-badge";
import { SubmitButton } from "@/components/app/submit-button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { formatSigned } from "@/lib/domain/format";
import type { PlanItem, Transition, TransitionComponents } from "@/lib/planner";
import { initialActionState } from "@/lib/validation/schemas";

const TYPE_LABEL: Record<Transition["type"], string> = {
  blend: "Long blend",
  short_blend: "Short blend",
  cut: "Cut",
  sequential: "Plays next",
};

const COMPONENT_LABEL: Record<keyof TransitionComponents, string> = {
  harmonic: "Harmonic",
  tempo: "Tempo",
  energyStep: "Energy step",
  cue: "Cue review state",
  vocal: "Vocal overlap",
  style: "Style",
};

const RELATION_LABEL: Record<NonNullable<Transition["keyRelation"]>, string> = {
  same: "Same key",
  adjacent: "Adjacent",
  relative: "Relative",
  diagonal: "Diagonal",
  two_steps: "Two steps",
  distant: "Distant",
};

/** Longest overlap the crossfader band draws at full width, in seconds. */
const FULL_BAND_SECONDS = 64;

/**
 * The transition as a two-deck mixer: deck A going out, deck B coming in, and a crossfader
 * whose lit band shows how long both play together. Readouts below give the tempo change,
 * key relation, and overlap. Decorative parts are hidden; the text carries every value.
 */
function MixerView({ transition: t, from, to }: { transition: Transition; from: PlanItem; to: PlanItem | null }) {
  const listening = t.type === "sequential";
  const band = t.type === "cut" ? 0 : Math.min(1, t.overlapSeconds / FULL_BAND_SECONDS);
  const deck = (letter: "A" | "B", item: PlanItem | null, note: string | null, align: "start" | "end") => (
    <div className={`flex min-w-0 items-center gap-2.5 ${align === "end" ? "flex-row-reverse text-right" : ""}`}>
      <span
        aria-hidden
        className={`flex size-7 shrink-0 items-center justify-center rounded-[6px] font-mono text-[13px] font-bold text-[var(--led-ink)] ${letter === "A" ? "bg-[var(--led-orange)] shadow-[0_0_10px_-2px_var(--led-orange)]" : "bg-[var(--electric)] shadow-[0_0_10px_-2px_var(--electric)]"}`}
      >
        {letter}
      </span>
      <span className="min-w-0">
        <span className="sr-only">Deck {letter}: </span>
        <span className="block truncate font-semibold text-ink">{item?.title ?? "Next track"}</span>
        {note ? <span className="block truncate text-caption text-muted">{note}</span> : null}
      </span>
    </div>
  );
  return (
    <div className="deck-screen m-1 mt-3 p-3 sm:p-4">
      {/* Phones stack deck A, the crossfader, then deck B so both titles stay readable. */}
      <div className="grid grid-cols-1 items-center gap-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:gap-5">
        {deck("A", from, listening ? null : `Out: ${from.exitLabel}`, "start")}
        <div className="flex flex-col items-center gap-1.5">
          {listening ? (
            <span aria-hidden className="font-mono text-[18px] text-muted">
              →
            </span>
          ) : (
            <span aria-hidden className="relative block h-5 w-20 sm:w-28">
              <span className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-black shadow-[inset_0_1px_1px_rgb(255_255_255/0.08)]" />
              <span
                className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-[var(--led-orange)] shadow-[0_0_8px_var(--led-orange)]"
                style={{ left: `${50 - band * 50}%`, width: `${Math.max(band * 100, 2)}%` }}
              />
              <span
                className="absolute top-1/2 h-5 w-3 -translate-x-1/2 -translate-y-1/2 rounded-[3px] border border-[var(--key-edge)] bg-[linear-gradient(180deg,var(--key-face-top),var(--key-face))] shadow-[0_2px_0_var(--key-skirt)]"
                style={{ left: t.type === "cut" ? "100%" : "50%" }}
              >
                <span className="absolute inset-x-0.5 top-1/2 h-px bg-[var(--led-orange)]" />
              </span>
            </span>
          )}
          <span className="font-mono text-[11px] font-semibold tracking-[0.12em] text-muted uppercase">{TYPE_LABEL[t.type]}</span>
        </div>
        {deck("B", to, listening ? null : `In: ${to?.entryLabel ?? "entry"}`, "end")}
      </div>
      {!listening ? (
        <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-divider pt-3 text-center">
          {[
            ["Tempo", t.tempoAdjustPct === null ? "n/a" : `${formatSigned(t.tempoAdjustPct)}%`],
            ["Key", t.keyRelation ? RELATION_LABEL[t.keyRelation] : "n/a"],
            ["Overlap", t.overlapSeconds > 0 ? `${Math.round(t.overlapSeconds)} s` : "None"],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="text-eyebrow text-muted">{k}</dt>
              <dd className="mt-0.5 font-mono text-[15px] font-semibold text-ink">{v}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}

export const JUDGMENT_LABEL: Record<string, string> = {
  works: "Works",
  needs_adjustment: "Needs adjustment",
  clash: "Clash",
};

function JudgmentForm({ planId, transition }: { planId: string; transition: Transition }) {
  const [state, formAction] = useActionState(judgeTransition.bind(null, planId), initialActionState);
  const id = `judge-${transition.fromTrackId}-${transition.toTrackId}`;
  return (
    <details className="mt-1">
      <summary className="min-h-11 cursor-pointer py-2 text-ui text-action">Record your judgment</summary>
    <ActionForm state={state} action={formAction} className="mt-2 flex flex-col gap-3 border-t border-divider pt-4">
      <input type="hidden" name="from_track_id" value={transition.fromTrackId} />
      <input type="hidden" name="to_track_id" value={transition.toTrackId} />
      <input type="hidden" name="exit_option_id" value={transition.exitOptionId} />
      <input type="hidden" name="entry_option_id" value={transition.entryOptionId} />
      <div className="grid gap-3 sm:grid-cols-[200px_1fr_auto] sm:items-end">
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${id}-j`}>Your judgment</Label>
          <NativeSelect id={`${id}-j`} name="judgment" defaultValue="works">
            <option value="works">Works</option>
            <option value="needs_adjustment">Needs adjustment</option>
            <option value="clash">Clash</option>
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${id}-n`}>Note</Label>
          <Input id={`${id}-n`} name="note" maxLength={2000} placeholder="Optional: what you heard or changed" />
        </div>
        <SubmitButton variant="secondary" pendingLabel="Saving">
          Record
        </SubmitButton>
      </div>
      <FormMessage state={state} />
    </ActionForm>
    </details>
  );
}

export function TransitionCard({
  index,
  transition,
  worst,
  planId,
  judgment,
  allowJudging,
  from,
  to,
}: {
  index: number;
  transition: Transition;
  from: PlanItem;
  to: PlanItem | null;
  worst: boolean;
  planId: string;
  judgment?: string;
  allowJudging: boolean;
}) {
  const t = transition;
  const listening = t.type === "sequential";
  return (
    <div className="relative ml-5 border-l-2 border-action/25 py-3 pl-6 md:ml-[21px]">
      <ArrowDown className="absolute top-4 -left-[9px] size-4 rounded-full bg-canvas text-action" aria-hidden />
      <div className="panel p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-ui text-ink">
            Transition {index + 1} to {index + 2}
          </span>
          {t.reviewNeeded ? <StatusBadge kind="review" /> : null}
          {worst ? <Badge tone="warning">Weakest transition</Badge> : null}
          {judgment ? <Badge tone={judgment === "works" ? "success" : judgment === "clash" ? "error" : "warning"}>You: {JUDGMENT_LABEL[judgment]}</Badge> : null}
          <span className="ml-auto inline-flex items-center gap-2 text-data text-muted" title="Weighted transition cost from 0 (no concerns) to 1">
            <span aria-hidden className="h-1.5 w-16 overflow-hidden rounded-full bg-surface-subtle">
              <span
                className={`block h-full rounded-full ${t.cost < 0.25 ? "bg-success" : t.cost < 0.5 ? "bg-warning" : "bg-error"}`}
                style={{ width: `${Math.max(6, (1 - Math.min(1, t.cost)) * 100)}%` }}
              />
            </span>
            cost {t.cost.toFixed(2)}
          </span>
        </div>
        <MixerView transition={t} from={from} to={to} />
        <p className="mt-3 text-[15px]">{t.explanation}</p>
        {t.type === "cut" ? (
          <p className="mt-1 text-caption text-muted">Both tracks play at their original tempo; no beatmatch is assumed.</p>
        ) : !listening && t.playbackRate !== null ? (
          <p className="mt-1 text-caption text-muted">
            Incoming playback at <span className="text-data">{(t.playbackRate * 100).toFixed(1)}%</span> (
            {formatSigned(t.tempoAdjustPct ?? 0)}%), key lock {t.keyLock ? "on" : "off"}
            {t.soundingShiftSemitones ? `, sounding shift ${formatSigned(t.soundingShiftSemitones, 0)} semitones` : ""}.
          </p>
        ) : null}
        <details className="mt-3">
          <summary className="min-h-11 cursor-pointer py-2 text-ui text-action">Score components</summary>
          <div className="overflow-x-auto">
            <table className="w-full text-[14px]">
              <thead>
                <tr className="border-b border-divider text-left">
                  <th className="py-2 pr-3">Component</th>
                  <th className="py-2 pr-3">Evidence</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3 text-right">Cost (0 to 1)</th>
                  <th className="py-2 text-right">Weight</th>
                </tr>
              </thead>
              <tbody>
                {(Object.keys(t.components) as (keyof TransitionComponents)[]).map((k) => {
                  const c = t.components[k];
                  return (
                    <tr key={k} className="border-b border-divider/60">
                      <td className="py-1.5 pr-3 whitespace-nowrap">{COMPONENT_LABEL[k]}</td>
                      <td className="py-1.5 pr-3">{c.detail}</td>
                      <td className="py-1.5 pr-3 whitespace-nowrap">
                        {c.status === "measured" ? "Measured" : c.status === "missing" ? "Missing (neutral cost)" : "Not applicable"}
                      </td>
                      <td className="py-1.5 pr-3 text-right text-data">{c.status === "not_applicable" ? "n/a" : c.cost.toFixed(2)}</td>
                      <td className="py-1.5 text-right text-data">{c.weight.toFixed(2)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </details>
        {allowJudging ? <JudgmentForm planId={planId} transition={t} /> : null}
      </div>
    </div>
  );
}
