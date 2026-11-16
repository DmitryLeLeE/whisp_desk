export type Action = "KEEP" | "CUT";

export interface Segment {
  id: string;
  source_start_ms: number;
  source_end_ms: number;
  action: Action;
  reason: string;
  reviewed: boolean;
  locked: boolean;
  manual: boolean;
}

export interface Plan {
  schema_version: number;
  duration_ms: number;
  fps: { numerator: number; denominator: number };
  segments: Segment[];
}

export interface PlanPayload {
  plan: Plan;
  stats: { source_ms: number; output_ms: number; removed_ms: number; segments: number; unreviewed: number };
  can_undo: boolean;
  can_redo: boolean;
}

export interface Job {
  id: number;
  project_id: string;
  kind: string;
  status: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";
  stage: string;
  progress: number;
  message: string;
  error: string | null;
  elapsed_s?: number | null;
  result: Record<string, unknown> | null;
  log?: string[];
}

export interface ProjectRow { id: string; name: string; type: string; created: string; updated: string }

export interface AudioStream { index: number; codec: string; sample_rate: number; channels: number; language?: string | null; title?: string | null }

export interface Metadata {
  filename: string; duration_ms: number; size_bytes: number; container: string; has_video: boolean;
  has_subtitles: boolean;
  video?: { codec: string; width: number; height: number; fps_value: number; variable_frame_rate: boolean };
  audio_streams: AudioStream[];
}

export interface Project extends ProjectRow {
  description: string;
  settings: {
    profile: string; overrides: Record<string, number | null>; audio_stream: number; template: string;
    scene_threshold: number; detect_scenes: boolean; engine: string;
  };
  source: { path: string; filename: string; size_bytes: number } | null;
  has_plan: boolean; has_proxy: boolean; has_subtitles: boolean;
  active_job: Job | null;
  metadata: Metadata | null;
}

export interface Profile {
  label: string; noise_db: number; min_pause_s: number; pad_before_s: number; pad_after_s: number;
  min_keep_s: number; low_volume_db: number | null; low_volume_min_s: number | null;
}

export interface Cue { start_ms: number; end_ms: number; text: string }
export interface FsEntry { name: string; dir: boolean; path: string }
export interface FsListing { path: string; parent: string | null; entries: FsEntry[] }
export interface ExportFile { name: string; size: number; where: string }
export interface Compare { builtin: { cuts: number; cut_ms: number }; auto_editor: { cuts: number; cut_ms: number }; overlap_ms: number; agreement: number }
export interface Thumbs { files: string[]; times_ms: number[] }
export interface Scenes { engine: string; boundaries_ms: number[] }
export interface Waveform { peaks_per_second: number; peaks: number[] }
export interface VersionInfo { name: string; label: string; created: string }
export interface TemplateInfo { id: string; name: string; description: string }
