"use client";

import { ArrowDown } from "lucide-react";
import { useActionState } from "react";
import { judgeTransition } from "@/app/actions/plans";
import { FormMessage } from "@/components/app/form-message";
import { StatusBadge } from "@/components/app/status-badge";
import { SubmitButton } from "@/components/app/submit-button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { formatSigned } from "@/lib/domain/format";
import type { Transition, TransitionComponents } from "@/lib/planner";
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
    <form action={formAction} className="mt-2 flex flex-col gap-3 border-t border-divider pt-4">
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
    </form>
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
}: {
  index: number;
  transition: Transition;
  worst: boolean;
  planId: string;
  judgment?: string;
  allowJudging: boolean;
}) {
  const t = transition;
  const listening = t.type === "sequential";
  return (
    <div className="relative ml-4 border-l-2 border-dashed border-control-border/50 py-3 pl-6 md:ml-6">
      <ArrowDown className="absolute top-4 -left-[9px] size-4 rounded-full bg-canvas text-muted" aria-hidden />
      <div className="rounded-[12px] border border-divider bg-surface p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-ui text-ink">
            Transition {index + 1} to {index + 2}
          </span>
          <Badge tone="action">{TYPE_LABEL[t.type]}</Badge>
          {t.overlapSeconds > 0 ? <Badge>{Math.round(t.overlapSeconds)} s overlap</Badge> : null}
          {t.reviewNeeded ? <StatusBadge kind="review" /> : null}
          {worst ? <Badge tone="warning">Weakest transition</Badge> : null}
          {judgment ? <Badge tone={judgment === "works" ? "success" : judgment === "clash" ? "error" : "warning"}>You: {JUDGMENT_LABEL[judgment]}</Badge> : null}
          <span className="ml-auto text-data text-muted" title="Weighted transition cost from 0 (no concerns) to 1">
            cost {t.cost.toFixed(2)}
          </span>
        </div>
        <p className="mt-2 text-[15px]">{t.explanation}</p>
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
