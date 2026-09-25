import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { deleteTrack, updateTrack } from "@/app/actions/tracks";
import { ConfirmDelete } from "@/components/app/confirm-delete";
import { MetricCard } from "@/components/app/metric-card";
import { PageHeader } from "@/components/app/page-header";
import { StatusBadge } from "@/components/app/status-badge";
import { AnnotationList } from "@/components/library/annotation-list";
import { CueEditor } from "@/components/library/cue-editor";
import { TrackForm } from "@/components/library/track-form";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { describeTrackKey } from "@/lib/domain/camelot";
import { formatBpm, formatTime } from "@/lib/domain/format";
import { getTrack, listTrackAnnotations } from "@/lib/data/queries";
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
  const [track, annotations] = await Promise.all([getTrack(supabase, trackId), listTrackAnnotations(supabase, trackId)]);
  if (!track) notFound();

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
            {track.title}
            {track.versionLabel ? <span className="text-muted"> ({track.versionLabel})</span> : null}
          </>
        }
        lead={[track.artist || "Unknown artist", track.styleTags.join(", ")].filter(Boolean).join(" · ")}
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
          status={<StatusBadge kind={track.bpm === null ? "unavailable" : track.bpmSource === "reviewed" ? "reviewed" : "estimated"} />}
          detail={track.bpmAlternatives.length ? `Alternatives: ${track.bpmAlternatives.join(", ")} BPM` : "No alternative pulse recorded"}
        />
        <MetricCard
          label="Key"
          value={track.keyTonic === null ? null : describeTrackKey(track.keyTonic, track.keyMode, track.keyStatus)}
          status={<StatusBadge kind={keyKind} />}
          detail={track.keyStatus === "uncertain" ? "Left out of harmonic scoring" : "Camelot code and key name"}
        />
        <MetricCard
          label="Relative energy"
          value={track.energy}
          unit="of 10"
          status={<StatusBadge kind={track.energy === null ? "unavailable" : track.energySource === "reviewed" ? "reviewed" : "estimated"} />}
          detail="Your annotation, not a calibrated loudness measure"
        />
        <MetricCard label="Duration" value={formatTime(track.durationSeconds)} detail={track.assetId ? `Asset ${track.assetId.slice(0, 16)}` : "No analyzer asset linked"} />
      </div>

      <Tabs defaultValue="cues" className="mt-12">
        <TabsList aria-label="Track sections">
          <TabsTrigger value="cues">Cue regions</TabsTrigger>
          <TabsTrigger value="details">Edit details</TabsTrigger>
          <TabsTrigger value="history">Revision history</TabsTrigger>
        </TabsList>
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
