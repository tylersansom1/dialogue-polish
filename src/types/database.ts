export type AudioFileType = 'original' | 'processed';

export type JobStatus = 'uploaded' | 'queued' | 'processing' | 'completed' | 'failed';

export type AnalysisStatus = 'pending' | 'running' | 'completed' | 'failed';

export type IssueType =
  | 'clipping'
  | 'near_clipping'
  | 'low_dialogue'
  | 'high_dialogue'
  | 'level_jump'
  | 'high_noise'
  | 'hum'
  | 'rumble'
  | 'harshness'
  | 'sibilance'
  | 'resonance'
  | 'dc_offset'
  | 'channel_imbalance'
  | 'phase_problem';

export type IssueSeverity = 'info' | 'mild' | 'moderate' | 'significant';

export interface Project {
  id: string;
  user_id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface WaveformPeak {
  min: number;
  max: number;
}

export interface AudioFile {
  id: string;
  project_id: string;
  user_id: string;
  original_filename: string;
  storage_path: string;
  type: AudioFileType;
  duration_seconds: number | null;
  sample_rate: number | null;
  bit_depth: number | null;
  channels: number | null;
  file_size: number | null;
  waveform_data: WaveformPeak[] | null;
  created_at: string;
}

export interface ProcessingJob {
  id: string;
  project_id: string;
  user_id: string;
  source_audio_file_id: string | null;
  output_audio_file_id: string | null;
  status: JobStatus;
  progress: number;
  error_message: string | null;
  processing_version: string;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface ProjectWithDetails extends Project {
  audio_files: AudioFile[];
  processing_jobs: ProcessingJob[];
}

export interface AudioMetadata {
  filename: string;
  durationSeconds: number;
  sampleRate: number;
  bitDepth: number;
  channels: number;
  fileSize: number;
  format: string;
}

export interface DialogueAnalysis {
  id: string;
  audio_file_id: string;
  user_id: string;
  analysis_version: string;
  status: AnalysisStatus;
  integrated_lufs: number | null;
  loudness_range: number | null;
  true_peak: number | null;
  sample_peak: number | null;
  maximum_momentary_loudness: number | null;
  maximum_short_term_loudness: number | null;
  rms_average: number | null;
  estimated_noise_floor: number | null;
  dynamic_range: number | null;
  crest_factor: number | null;
  dc_offset: number | null;
  clipping_count: number | null;
  speech_percentage: number | null;
  analysis_data_json: AnalysisModuleData | null;
  summary_text: string | null;
  created_at: string;
  completed_at: string | null;
  error_message: string | null;
}

export interface DialogueAnalysisIssue {
  id: string;
  analysis_id: string;
  user_id: string;
  issue_type: IssueType;
  severity: IssueSeverity;
  start_time: number | null;
  end_time: number | null;
  center_frequency: number | null;
  measured_value: number | null;
  threshold_value: number | null;
  description: string;
  confidence: number | null;
  created_at: string;
}

export interface AnalysisModuleData {
  file_info?: ModuleResult;
  loudness?: ModuleResult;
  peaks?: ModuleResult;
  level_consistency?: ModuleResult;
  noise_floor?: ModuleResult;
  hum?: ModuleResult;
  spectrum?: ModuleResult;
  rumble?: ModuleResult;
  harshness_sibilance?: ModuleResult;
  resonance?: ModuleResult;
  dynamics?: ModuleResult;
  silence?: ModuleResult;
  dc_offset?: ModuleResult;
  phase?: ModuleResult;
  speech?: ModuleResult;
  [key: string]: ModuleResult | undefined;
}

export interface ModuleResult {
  status: 'success' | 'failed' | 'skipped';
  data?: Record<string, unknown>;
  error?: string;
}
