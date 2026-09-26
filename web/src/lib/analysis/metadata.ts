/** File identity and tag reading for the browser. */

/** SHA-256 of the file bytes as lowercase hex: the same asset ID the CLI computes. */
export async function assetId(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export interface FileTags {
  title: string;
  artist: string;
  bpm: number | null;
  key: string | null;
}

function decodeText(bytes: Uint8Array, encoding: number): string {
  const label = encoding === 1 ? "utf-16" : encoding === 2 ? "utf-16be" : encoding === 3 ? "utf-8" : "latin1";
  return new TextDecoder(label).decode(bytes).replace(/\u0000/g, "").trim();
}

function syncsafe(b: Uint8Array, o: number): number {
  return ((b[o]! & 0x7f) << 21) | ((b[o + 1]! & 0x7f) << 14) | ((b[o + 2]! & 0x7f) << 7) | (b[o + 3]! & 0x7f);
}

/** Reads TIT2, TPE1, TBPM, and TKEY from an ID3v2.3 or v2.4 tag, if present. */
export function readId3(buffer: ArrayBuffer): Partial<FileTags> {
  const b = new Uint8Array(buffer);
  if (b.length < 10 || b[0] !== 0x49 || b[1] !== 0x44 || b[2] !== 0x33) return {};
  const version = b[3]!;
  if (version < 3 || version > 4) return {};
  const size = syncsafe(b, 6);
  const tags: Partial<FileTags> = {};
  let o = 10;
  if (b[5]! & 0x40) o += version === 4 ? syncsafe(b, 10) : ((b[10]! << 24) | (b[11]! << 16) | (b[12]! << 8) | b[13]!) + 4;
  const end = Math.min(b.length, 10 + size);
  while (o + 10 <= end) {
    const id = String.fromCharCode(b[o]!, b[o + 1]!, b[o + 2]!, b[o + 3]!);
    if (!/^[A-Z0-9]{4}$/.test(id)) break;
    const frameSize = version === 4 ? syncsafe(b, o + 4) : (b[o + 4]! << 24) | (b[o + 5]! << 16) | (b[o + 6]! << 8) | b[o + 7]!;
    const body = b.subarray(o + 10, o + 10 + frameSize);
    if (body.length && id.startsWith("T")) {
      const text = decodeText(body.subarray(1), body[0]!);
      if (id === "TIT2") tags.title = text;
      else if (id === "TPE1") tags.artist = text;
      else if (id === "TBPM" && Number.isFinite(Number(text))) tags.bpm = Number(text);
      else if (id === "TKEY") tags.key = text;
    }
    o += 10 + frameSize;
  }
  return tags;
}

/** Tags from the file, falling back to "Artist - Title" in the file name. */
export function tagsFor(fileName: string, buffer: ArrayBuffer): FileTags {
  const id3 = readId3(buffer);
  const base = fileName.replace(/\.[^.]+$/, "").replace(/_/g, " ").trim();
  const dash = base.split(/\s+-\s+/);
  const fromName = dash.length >= 2 ? { artist: dash[0]!.trim(), title: dash.slice(1).join(" - ").trim() } : { artist: "", title: base };
  return {
    title: id3.title || fromName.title || "Untitled",
    artist: id3.artist || fromName.artist,
    bpm: id3.bpm ?? null,
    key: id3.key ?? null,
  };
}

/**
 * Native sample rate from the file header (WAV, FLAC, MP3, MP4/M4A), or null. Decoding at
 * this rate keeps the analysis on the source samples, as the CLI does, instead of the
 * browser's default output rate.
 */
export function sniffSampleRate(buffer: ArrayBuffer): number | null {
  const b = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const ascii = (o: number, n: number) => String.fromCharCode(...b.subarray(o, o + n));
  const plausible = (r: number) => (r >= 8000 && r <= 384000 ? r : null);
  if (b.length < 12) return null;

  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WAVE") {
    for (let o = 12; o + 8 <= b.length; ) {
      const size = view.getUint32(o + 4, true);
      if (ascii(o, 4) === "fmt " && o + 16 <= b.length) return plausible(view.getUint32(o + 12, true));
      o += 8 + size + (size % 2);
    }
    return null;
  }
  if (ascii(0, 4) === "fLaC" && b.length >= 21) {
    // STREAMINFO: 20-bit sample rate after the 4-byte block header and 10 bytes of block sizes.
    return plausible((b[18]! << 12) | (b[19]! << 4) | (b[20]! >> 4));
  }
  const mdhd = (() => {
    for (let o = 4; o + 32 <= Math.min(b.length, 4_000_000); o++) {
      if (b[o] === 0x6d && b[o + 1] === 0x64 && b[o + 2] === 0x68 && b[o + 3] === 0x64) return o;
    }
    return -1;
  })();
  if (ascii(4, 4) === "ftyp" && mdhd > 0) {
    const version = b[mdhd + 4]!;
    return plausible(view.getUint32(mdhd + (version === 1 ? 24 : 16), false));
  }
  // MP3: skip an ID3v2 tag, then read the first frame header.
  let o = 0;
  if (ascii(0, 3) === "ID3") o = 10 + (((b[6]! & 0x7f) << 21) | ((b[7]! & 0x7f) << 14) | ((b[8]! & 0x7f) << 7) | (b[9]! & 0x7f));
  for (const limit = Math.min(b.length - 4, o + 65536); o < limit; o++) {
    if (b[o] !== 0xff || (b[o + 1]! & 0xe0) !== 0xe0) continue;
    const version = (b[o + 1]! >> 3) & 0x03;
    const layer = (b[o + 1]! >> 1) & 0x03;
    const index = (b[o + 2]! >> 2) & 0x03;
    if (version === 1 || layer === 0 || index === 3) continue;
    const base = [44100, 48000, 32000][index]!;
    return version === 3 ? base : version === 2 ? base / 2 : base / 4;
  }
  return null;
}
