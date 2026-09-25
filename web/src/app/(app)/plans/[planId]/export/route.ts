import { NextResponse, type NextRequest } from "next/server";
import { getPlan } from "@/lib/data/queries";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/validation/schemas";

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "plan";
}

/** Downloads the current proposal as CSV (one row per track) or the full plan as JSON. */
export async function GET(request: NextRequest, { params }: RouteContext<"/plans/[planId]/export">) {
  const { planId } = await params;
  if (!isUuid(planId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const plan = await getPlan(supabase, planId);
  if (!plan) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const format = request.nextUrl.searchParams.get("format") === "json" ? "json" : "csv";
  const filename = `${slug(plan.name)}.${format}`;

  if (format === "json") {
    return new NextResponse(JSON.stringify({ name: plan.name, request: plan.request, result: plan.result }, null, 2), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}"`,
      },
    });
  }

  const header = [
    "position",
    "title",
    "artist",
    "elapsed_start_s",
    "play_start_s",
    "play_end_s",
    "entry",
    "entry_status",
    "exit",
    "exit_status",
    "energy",
    "target_energy",
    "next_transition",
    "overlap_s",
    "tempo_adjust_pct",
    "transition_cost",
    "review_needed",
    "explanation",
  ];
  const { items, transitions } = plan.result.proposal;
  const lines = items.map((it, i) => {
    const t = transitions[i];
    return [
      i + 1,
      it.title,
      it.artist,
      it.elapsedStartSeconds.toFixed(1),
      it.playStartSeconds.toFixed(1),
      it.playEndSeconds.toFixed(1),
      it.entryLabel,
      it.entryOrigin,
      it.exitLabel,
      it.exitOrigin,
      it.energy ?? "",
      it.targetEnergy === null ? "" : it.targetEnergy.toFixed(2),
      t ? t.type : "",
      t ? t.overlapSeconds.toFixed(1) : "",
      t && t.tempoAdjustPct !== null ? t.tempoAdjustPct.toFixed(2) : "",
      t ? t.cost.toFixed(3) : "",
      t ? (t.reviewNeeded ? "yes" : "no") : "",
      t ? t.explanation : "",
    ]
      .map(csvCell)
      .join(",");
  });
  return new NextResponse([header.join(","), ...lines].join("\r\n") + "\r\n", {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}
