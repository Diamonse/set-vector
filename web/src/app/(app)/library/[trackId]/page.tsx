import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { deleteTrack, updateTrack } from "@/app/actions/tracks";
import { ConfirmDelete } from "@/components/app/confirm-delete";
import { MetricCard } from "@/components/app/metric-card";
import { PageHeader } from "@/components/app/page-header";
import { StatusBadge } from "@/components/app/status-badge";
import { AnalysisSummary } from "@/components/analysis/analysis-summary";
import { AnnotationList } from "@/components/library/annotation-list";
import { AudioEditor, type EditorGrid, type EditorPoint } from "@/components/library/audio-editor";
import { CueDeck } from "@/components/library/cue-deck";
import { CueEditor } from "@/components/library/cue-editor";
import { TrackForm } from "@/components/library/track-form";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { KeyChip } from "@/components/music/key-chip";
import { formatKeyName } from "@/lib/domain/camelot";
import { formatBpm, formatTime } from "@/lib/domain/format";
import { EnergyBreakdown } from "@/components/energy/energy-breakdown";
import { KineticTextReveal } from "@/components/ui/kinetic-text-reveal";
import { loadLibraryEnergy } from "@/lib/data/energy";
import { getLatestAnalysis, getRekordboxLink, getTrack, listTrackAnnotations } from "@/lib/data/queries";
import { gridForDisplay } from "@/lib/rekordbox/grid";
import { requireUser } from "@/lib/supabase/server";
import { isUuid } from "@/lib/validation/schemas";

export async function generateMetadata({ params }: PageProps<"/library/[trackId]">): Promise<Metadata> {
  const { trackId } = await params;
  if (!isUuid(trackId)) return { title: "Track" };
  const { supabase } = await requireUser();
  const track = await getTrack(supabase, trackId);
  return { title: track?.title ?? "Track" };
}

export default async function TrackPage({ params }: PageProps<"/library/[trackId]">) {
  const { trackId } = await params;
  if (!isUuid(trackId)) notFound();
  const { supabase } = await requireUser();
  const [track, annotations, analysis, rekordbox, libraryEnergy] = await Promise.all([
    getTrack(supabase, trackId),
    listTrackAnnotations(supabase, trackId),
    getLatestAnalysis(supabase, trackId),
    getRekordboxLink(supabase, trackId),
    loadLibraryEnergy(supabase).catch(() => null),
  ]);
  if (!track) notFound();
  const energyEstimate = libraryEnergy?.estimates.get(track.id) ?? null;
  const userEnergy = track.energy !== null && !track.energyModel ? track.energy : null;

  const grids: EditorGrid[] = [];
  if (analysis?.result.rhythm.beats.length) {
    grids.push({ id: "analysis", label: "Analyzer", beats: analysis.result.rhythm.beats, downbeats: analysis.result.rhythm.downbeats });
  }
  if (rekordbox?.tempo.length) {
    try {
      grids.push({ id: "rekordbox", label: "Rekordbox", ...gridForDisplay(rekordbox.tempo, track.durationSeconds) });
    } catch {
      // A stored grid that no longer expands is left out rather than breaking the page.
    }
  }
  const points: EditorPoint[] = (rekordbox?.marks ?? [])
    .filter((m) => m.startSeconds <= track.durationSeconds)
    .map((m) => ({
      time: m.startSeconds,
      label: m.slot === null ? m.name || "Memory cue" : `Hot cue ${String.fromCharCode(65 + m.slot)}${m.name ? ` ${m.name}` : ""}`,
      color: m.colour ? `rgb(${m.colour.join(", ")})` : undefined,
    }))
    .sort((a, b) => a.time - b.time);

  const keyKind =
    track.keyStatus === "reviewed" ? "reviewed" : track.keyStatus === "estimated" ? "estimated" : track.keyStatus === "uncertain" ? "uncertain" : "unavailable";

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/library" className="no-underline">
            Library
          </Link>
        }
        title={
          <>
            <KineticTextReveal text={track.title} delay={0.08} />
            {track.versionLabel ? (
              <>
                {" "}
                {/* The version label continues the title's stagger: one beat per preceding word. */}
                <KineticTextReveal text={`(${track.versionLabel})`} className="text-muted" delay={0.08 + track.title.split(/\s+/).length * 0.075} />
              </>
            ) : null}
          </>
        }
        lead={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="text-lead text-ink">{track.artist || "Unknown artist"}</span>
            {track.styleTags.map((s) => (
              <span key={s} className="rounded-full border border-divider bg-surface-subtle px-2.5 py-0.5 text-caption text-body">
                {s}
              </span>
            ))}
          </span>
        }
        actions={
          <ConfirmDelete
            title="Delete this track?"
            description="This removes the track, its cue regions, and its revision history. Plans keep their saved snapshot but lose this track's plan items."
            onConfirm={deleteTrack.bind(null, track.id)}
          />
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Tempo"
          value={track.bpm === null ? null : formatBpm(track.bpm)}
          unit="BPM"
          segment
          status={<StatusBadge kind={track.bpm === null ? "unavailable" : track.bpmSource === "reviewed" ? "reviewed" : "estimated"} />}
          detail={track.bpmAlternatives.length ? `Alternatives: ${track.bpmAlternatives.join(", ")} BPM` : "No alternative pulse recorded"}
        />
        <MetricCard
          label="Key"
          value={
            track.keyTonic === null || track.keyMode === null ? null : (
              <span className="flex flex-wrap items-center gap-3">
                <KeyChip musicalKey={{ tonic: track.keyTonic, mode: track.keyMode }} estimated={track.keyStatus !== "reviewed"} className="px-3 py-1 text-[20px] leading-7" />
                <span className="font-sans text-[15px] font-medium tracking-normal text-body">{formatKeyName({ tonic: track.keyTonic, mode: track.keyMode })}</span>
              </span>
            )
          }
          status={<StatusBadge kind={keyKind} />}
          detail={track.keyStatus === "uncertain" ? "Left out of harmonic scoring" : "Camelot code and key name"}
        />
        <MetricCard
          label="Relative energy"
          value={track.energy}
          unit="of 10"
          meter={track.energy === null ? null : track.energy / 10}
          status={<StatusBadge kind={track.energy === null ? "unavailable" : track.energySource === "reviewed" ? "reviewed" : "estimated"} />}
          detail={
            track.energyModel
              ? "Automatic estimate from the audio, relative to your library"
              : track.energy === null
                ? "Analyze the audio for an automatic estimate"
                : "Your rating; used instead of the automatic estimate"
          }
        />
        <MetricCard label="Duration" segment value={formatTime(track.durationSeconds)} detail={track.assetId ? `Asset ${track.assetId.slice(0, 16)}` : "No analyzer asset linked"} />
      </div>

      <div className="mt-6">
        <CueDeck cues={track.cues} duration={track.durationSeconds} />
      </div>

      <Tabs defaultValue="audio" className="mt-12">
        <TabsList aria-label="Track sections">
          <TabsTrigger value="audio">Audio and analysis</TabsTrigger>
          <TabsTrigger value="cues">Cue regions</TabsTrigger>
          <TabsTrigger value="details">Edit details</TabsTrigger>
          <TabsTrigger value="history">Revision history</TabsTrigger>
        </TabsList>
        <TabsContent value="audio" className="flex flex-col gap-8">
          <AnalysisSummary analysis={analysis} trackTitle={track.title} />
          <EnergyBreakdown estimate={energyEstimate} userEnergy={userEnergy} needsReanalysis={libraryEnergy?.needsReanalysis.has(track.id) ?? false} />
          <AudioEditor
            trackId={track.id}
            duration={track.durationSeconds}
            trackAssetId={track.assetId}
            cues={track.cues}
            grids={grids}
            points={points}
            storedPeaks={analysis?.result.waveform.peaks ?? null}
          />
        </TabsContent>
        <TabsContent value="cues">
          <CueEditor trackId={track.id} cues={track.cues} duration={track.durationSeconds} />
        </TabsContent>
        <TabsContent value="details">
          <TrackForm track={track} action={updateTrack.bind(null, track.id)} submitLabel="Save changes" />
        </TabsContent>
        <TabsContent value="history">
          <Card>
            <AnnotationList annotations={annotations} />
          </Card>
        </TabsContent>
      </Tabs>
    </>
  );
}
