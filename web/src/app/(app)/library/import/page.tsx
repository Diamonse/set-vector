import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page-header";
import { ImportForm } from "@/components/library/import-form";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Import tracks" };

const JSON_EXAMPLE = `{
  "tracks": [{
    "title": "Chandni Edit", "artist": "Example Artist",
    "version": "BollyHouse Edit", "remix_group": "chandni",
    "duration": "5:05", "styles": ["BollyHouse", "House"],
    "bpm": 125, "bpm_reviewed": true, "bpm_alternatives": [62.5],
    "key": "9A", "key_reviewed": true, "energy": 7,
    "asset_id": "optional id from setvector analyze",
    "cues": [
      { "kind": "entry", "start": "0:00", "end": "0:30", "reviewed": true, "vocal": "none" },
      { "kind": "exit", "start": "4:20", "end": "5:05", "vocal": "present" }
    ]
  }]
}`;

const CSV_EXAMPLE = `title,artist,duration,styles,bpm,key,key_status,energy,entry_cue,exit_cue,cues_reviewed
Warm Room,Example Artist,6:12,House,122,8A,reviewed,4,0:00-0:32,5:20-6:12,yes`;

export default function ImportPage() {
  return (
    <>
      <PageHeader
        title="Import tracks"
        lead="Bring in metadata from the offline analyzer, a spreadsheet, or other DJ software exports you have converted to JSON or CSV."
      />
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <ImportForm />
        <aside className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>JSON fields</CardTitle>
            </CardHeader>
            <pre className="overflow-x-auto rounded-[8px] bg-surface-subtle p-3 text-data text-[12px]">{JSON_EXAMPLE}</pre>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>CSV columns</CardTitle>
            </CardHeader>
            <pre className="overflow-x-auto rounded-[8px] bg-surface-subtle p-3 text-data text-[12px]">{CSV_EXAMPLE}</pre>
            <p className="mt-3 text-caption text-muted">
              Separate multiple styles or alternative tempos with <code>|</code>. Cue columns take <code>start-end</code>. Keys accept Camelot
              codes or names. Energy is your relative 1 to 10 scale.
            </p>
          </Card>
        </aside>
      </div>
    </>
  );
}
