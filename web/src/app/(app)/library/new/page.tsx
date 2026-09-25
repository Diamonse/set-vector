import type { Metadata } from "next";
import { createTrack } from "@/app/actions/tracks";
import { PageHeader } from "@/components/app/page-header";
import { TrackForm } from "@/components/library/track-form";

export const metadata: Metadata = { title: "Add track" };

export default function NewTrackPage() {
  return (
    <>
      <PageHeader title="Add a track" lead="Only title and duration are required. Add cue regions after saving." />
      <TrackForm action={createTrack} submitLabel="Save track" />
    </>
  );
}
