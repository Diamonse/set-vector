import type { KeyRelation } from "@/lib/domain/camelot";
import type {
  KeyMode,
  KeyStatus,
  MeasurementSource,
  PlanMode,
  ReviewStatus,
  SelectionPolicy,
  VocalActivity,
} from "@/lib/domain/types";

/** Track data the planner needs. Built from library rows; never mutated. */
export interface PlannerTrack {
  id: string;
  title: string;
  artist: string;
  remixGroup: string;
  durationSeconds: number;
  styleTags: string[];
  bpm: number | null;
  bpmAlternatives: number[];
  keyTonic: number | null;
  keyMode: KeyMode | null;
  keyStatus: KeyStatus;
  energy: number | null;
  cues: PlannerCue[];
}

export interface PlannerCue {
  id: string;
  kind: "entry" | "exit";
  startSeconds: number;
  endSeconds: number;
  label: string;
  provenance: MeasurementSource;
  reviewStatus: ReviewStatus;
  vocalActivity: VocalActivity;
}

export type ArcPreset = "none" | "flat" | "build" | "peak" | "wave" | "cooldown" | "opening" | "custom";

export interface ArcPoint {
  /** Fraction of elapsed planned playback time, 0 to 1. */
  t: number;
  /** Target relative energy on the user's 1 to 10 annotation scale. */
  energy: number;
}

export interface EnergyArc {
  preset: ArcPreset;
  points: ArcPoint[];
}

export type TransitionPreference = "auto" | "cut" | "blend";

export interface PlanPreferences {
  /** Largest tempo change, in percent, that a beatmatched overlap may assume. */
  maxTempoAdjustPct: number;
  /** Minimum number of other tracks between two tracks by the same artist or remix family. */
  artistSpacing: number;
  /** Whether playback keeps the original key when the tempo changes. */
  keyLock: boolean;
  transitionPreference: TransitionPreference;
  /** Minimum played span of each track in DJ mode, in seconds. */
  minPlayedSeconds: number;
}

export interface TransitionWeights {
  harmonic: number;
  tempo: number;
  energyStep: number;
  cue: number;
  vocal: number;
  style: number;
}

export interface PlanWeights {
  transition: TransitionWeights;
  /** Weight of the mean transition cost in the objective. */
  meanTransition: number;
  /** Weight of the single worst transition, so one bad pair is not hidden by a good mean. */
  worstTransition: number;
  arc: number;
  diversity: number;
}

export interface SearchSettings {
  beamWidth: number;
  branchFactor: number;
  maxCandidates: number;
  timeBudgetMs: number;
  seed: number;
  alternatives: number;
}

export interface RepeatPolicy {
  allowRepeats: boolean;
  /** Minimum number of other tracks between two plays of the same track. */
  minGapTracks: number;
}

export interface DurationTarget {
  minMinutes: number;
  maxMinutes: number;
}

export interface PlanRequest {
  mode: PlanMode;
  selectionPolicy: SelectionPolicy;
  candidateTrackIds: string[];
  targetCount: number | null;
  targetDuration: DurationTarget | null;
  requiredTrackIds: string[];
  excludedTrackIds: string[];
  startTrackId: string | null;
  endTrackId: string | null;
  repeatPolicy: RepeatPolicy;
  energyArc: EnergyArc;
  preferences: PlanPreferences;
  weights: PlanWeights;
  search: SearchSettings;
}

export type OptionOrigin = "reviewed" | "estimated" | "pending" | "fallback" | "full_track";

/** A concrete way to enter or leave a track: a cue region or a documented fallback. */
export interface CueOption {
  id: string;
  trackId: string;
  kind: "entry" | "exit";
  startSeconds: number;
  endSeconds: number;
  label: string;
  origin: OptionOrigin;
  vocalActivity: VocalActivity;
}

export type TransitionType = "blend" | "short_blend" | "cut" | "sequential";

export type EvidenceStatus = "measured" | "missing" | "not_applicable";

export interface CostComponent {
  cost: number;
  weight: number;
  status: EvidenceStatus;
  detail: string;
}

export interface TransitionComponents {
  harmonic: CostComponent;
  tempo: CostComponent;
  energyStep: CostComponent;
  cue: CostComponent;
  vocal: CostComponent;
  style: CostComponent;
}

/** A directional A to B transition evaluated at specific source regions. */
export interface Transition {
  fromTrackId: string;
  toTrackId: string;
  exitOptionId: string;
  entryOptionId: string;
  type: TransitionType;
  overlapSeconds: number;
  /** Playback rate applied to B so its pulse matches A. Null when tempo is unavailable. */
  playbackRate: number | null;
  tempoAdjustPct: number | null;
  tempoMultiple: number | null;
  keyRelation: KeyRelation | null;
  soundingShiftSemitones: number;
  keyLock: boolean;
  components: TransitionComponents;
  cost: number;
  reviewNeeded: boolean;
  reasons: string[];
  explanation: string;
}

export interface PlanItem {
  occurrenceId: string;
  position: number;
  trackId: string;
  title: string;
  artist: string;
  entryOptionId: string;
  exitOptionId: string;
  entryLabel: string;
  exitLabel: string;
  entryOrigin: OptionOrigin;
  exitOrigin: OptionOrigin;
  playStartSeconds: number;
  playEndSeconds: number;
  elapsedStartSeconds: number;
  /** Played span, including the outgoing overlap. */
  playedSeconds: number;
  energy: number | null;
  targetEnergy: number | null;
}

export type ViolationCode =
  | "missing_required"
  | "excluded_present"
  | "start_anchor"
  | "end_anchor"
  | "repeat"
  | "cue_conflict"
  | "duration"
  | "count"
  | "unknown_track";

export interface Violation {
  code: ViolationCode;
  message: string;
  position?: number;
}

export interface PlanMetrics {
  trackCount: number;
  totalSeconds: number;
  transitionCost: { mean: number; median: number; worst: number; worstIndex: number | null };
  reviewNeededShare: number;
  arc: { rmse: number | null; coverage: number; available: boolean };
  diversity: {
    artistViolations: number;
    remixViolations: number;
    styleCoverage: string[];
    longestStyleRun: number;
  };
  durationErrorSeconds: number | null;
  missingEvidence: { key: number; tempo: number; energy: number; reviewedCues: number };
}

export interface ObjectiveBreakdown {
  meanTransition: number;
  worstTransition: number;
  arc: number;
  diversity: number;
  duration: number;
  hardPenalty: number;
  total: number;
}

export interface EvaluatedPlan {
  label: string;
  items: PlanItem[];
  transitions: Transition[];
  metrics: PlanMetrics;
  violations: Violation[];
  objective: ObjectiveBreakdown;
}

export type BaselineKind = "random" | "bpm_sort" | "camelot" | "greedy";

export interface BaselineResult {
  kind: BaselineKind;
  label: string;
  plan: EvaluatedPlan;
}

export interface PlanResult {
  version: 1;
  mode: PlanMode;
  generatedAt: string;
  runtimeMs: number;
  evaluations: number;
  proposal: EvaluatedPlan;
  alternatives: EvaluatedPlan[];
  baselines: BaselineResult[];
  exact: { objective: number; gap: number; permutations: number } | null;
  warnings: string[];
  pool: { candidateCount: number; consideredCount: number; targetCount: number };
}

export interface RequestProblem {
  field: string;
  message: string;
}

export class PlanRequestError extends Error {
  constructor(public readonly problems: RequestProblem[]) {
    super(problems.map((p) => p.message).join("; "));
    this.name = "PlanRequestError";
  }
}
