import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/app/page-header";
import { RekordboxImport } from "@/components/library/rekordbox-import";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Import from Rekordbox" };

export default function RekordboxImportPage() {
  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/library/import" className="no-underline">
            Import
          </Link>
        }
        title="Import from Rekordbox"
        lead="Read a Rekordbox collection export in your browser, choose tracks, and add them to the library with their beat grids and cue points."
      />
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <RekordboxImport />
        <aside className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Export from Rekordbox</CardTitle>
            </CardHeader>
            <ol className="list-decimal pl-5 text-body">
              <li>In Rekordbox, choose File, then Export Collection in xml format.</li>
              <li>Choose the exported file here. It is read on this device; only the selected tracks&apos; metadata, tempo markers, and cue points are sent.</li>
            </ol>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>What is imported</CardTitle>
            </CardHeader>
            <ul className="list-disc pl-5 text-body">
              <li>Name, artist, mix, genre, and length. Genres become style tags.</li>
              <li>Average BPM and key, as estimates. Existing values in your library are kept; only empty fields are filled.</li>
              <li>The tempo markers, shown as a beat grid on the track&apos;s Audio tab. Rekordbox grids are a strong reference for bar lines, not ground truth.</li>
              <li>
                Hot cues, memory cues, and loops become approved entry and exit regions. A cue named like Intro or Mix in is an entry, Outro or
                Mix out an exit; unnamed cues in the first third are entries and in the last third exits. Each region runs 32 beats on the grid;
                loops keep their length.
              </li>
              <li>Tracks with a grid but no usable cue for the start or end get phrase-aligned suggestions from the grid to review.</li>
            </ul>
            <p className="mt-3 text-caption text-muted">
              Tracks are matched to your library by an earlier Rekordbox import of the same file, then by title and artist. Streaming tracks and
              entries without a length are skipped. Playlists are not read.
            </p>
          </Card>
        </aside>
      </div>
    </>
  );
}
