/*
# Phase 2 — Dialogue Analysis Schema

## Purpose
Persistent storage for real technical analysis of uploaded dialogue WAV files.
The analysis engine (Python DSP) measures loudness, peaks, noise, hum, spectral
balance, dynamics, speech regions, and other professional metrics, then stores
them here for the frontend to display.

## New Tables

### dialogue_analyses
- `id` (uuid, primary key)
- `audio_file_id` (uuid, not null, references audio_files, cascade delete) — the original file analyzed
- `user_id` (uuid, not null, defaults to auth.uid(), references auth.users, cascade delete) — owner
- `analysis_version` (text, not null) — e.g. "2.0.0", identifies which algorithm produced the results
- `status` (text, not null, default 'pending') — pending, running, completed, failed
- `integrated_lufs` (double precision) — ITU-R BS.1770 integrated loudness
- `loudness_range` (double precision) — LRA in LU
- `true_peak` (double precision) — true peak in dBTP
- `sample_peak` (double precision) — sample peak in dBFS
- `maximum_momentary_loudness` (double precision) — max momentary in LUFS
- `maximum_short_term_loudness` (double precision) — max short-term in LUFS
- `rms_average` (double precision) — average RMS in dBFS
- `estimated_noise_floor` (double precision) — estimated noise floor in dBFS
- `dynamic_range` (double precision) — dynamic range in dB
- `crest_factor` (double precision) — peak-to-RMS ratio in dB
- `dc_offset` (double precision) — DC offset as linear amplitude
- `clipping_count` (integer) — number of clipped sample events
- `speech_percentage` (double precision) — percentage of file containing detected speech (0-100)
- `analysis_data_json` (jsonb) — detailed sub-results: spectral bands, hum details, phase info, silence regions, speech regions, per-module status, spectral peaks, etc.
- `summary_text` (text) — human-readable summary generated from measured values
- `created_at` (timestamptz, default now())
- `completed_at` (timestamptz)
- `error_message` (text)

### dialogue_analysis_issues
- `id` (uuid, primary key)
- `analysis_id` (uuid, not null, references dialogue_analyses, cascade delete)
- `user_id` (uuid, not null, defaults to auth.uid(), references auth.users, cascade delete) — owner
- `issue_type` (text, not null) — one of: clipping, near_clipping, low_dialogue, high_dialogue, level_jump, high_noise, hum, rumble, harshness, sibilance, resonance, dc_offset, channel_imbalance, phase_problem
- `severity` (text, not null, default 'info') — one of: info, mild, moderate, significant
- `start_time` (double precision) — start position in seconds
- `end_time` (double precision) — end position in seconds
- `center_frequency` (double precision) — frequency in Hz if applicable
- `measured_value` (double precision) — the measured value
- `threshold_value` (double precision) — the threshold that was applied
- `description` (text) — human-readable description
- `confidence` (double precision) — 0.0 to 1.0
- `created_at` (timestamptz, default now())

## Security
- RLS enabled on both tables.
- Owner-scoped CRUD policies (user_id = auth.uid()) matching the existing pattern.
- user_id columns default to auth.uid() so frontend inserts that omit user_id succeed.

## Important Notes
1. Analysis jobs reuse the existing processing_jobs table with processing_version = "analysis-2.0.0".
   No new job table or status values needed — the existing queued/processing/completed/failed flow covers it.
2. dialogue_analyses.analysis_data_json stores detailed sub-results that don't fit in structured columns.
3. All timestamps in dialogue_analysis_issues are in seconds (decimal) for high precision.
4. Issue severity never uses "critical" — that is reserved for genuine technical failures.
*/

CREATE TABLE IF NOT EXISTS dialogue_analyses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audio_file_id uuid NOT NULL REFERENCES audio_files(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  analysis_version text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  integrated_lufs double precision,
  loudness_range double precision,
  true_peak double precision,
  sample_peak double precision,
  maximum_momentary_loudness double precision,
  maximum_short_term_loudness double precision,
  rms_average double precision,
  estimated_noise_floor double precision,
  dynamic_range double precision,
  crest_factor double precision,
  dc_offset double precision,
  clipping_count integer,
  speech_percentage double precision,
  analysis_data_json jsonb,
  summary_text text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  error_message text
);

ALTER TABLE dialogue_analyses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_analyses" ON dialogue_analyses;
CREATE POLICY "select_own_analyses" ON dialogue_analyses FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_analyses" ON dialogue_analyses;
CREATE POLICY "insert_own_analyses" ON dialogue_analyses
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_analyses" ON dialogue_analyses;
CREATE POLICY "update_own_analyses" ON dialogue_analyses FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_analyses" ON dialogue_analyses;
CREATE POLICY "delete_own_analyses" ON dialogue_analyses FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_dialogue_analyses_audio_file_id ON dialogue_analyses(audio_file_id);
CREATE INDEX IF NOT EXISTS idx_dialogue_analyses_user_id ON dialogue_analyses(user_id);

CREATE TABLE IF NOT EXISTS dialogue_analysis_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id uuid NOT NULL REFERENCES dialogue_analyses(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  issue_type text NOT NULL CHECK (issue_type IN (
    'clipping', 'near_clipping', 'low_dialogue', 'high_dialogue', 'level_jump',
    'high_noise', 'hum', 'rumble', 'harshness', 'sibilance', 'resonance',
    'dc_offset', 'channel_imbalance', 'phase_problem'
  )),
  severity text NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'mild', 'moderate', 'significant')),
  start_time double precision,
  end_time double precision,
  center_frequency double precision,
  measured_value double precision,
  threshold_value double precision,
  description text,
  confidence double precision,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE dialogue_analysis_issues ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_analysis_issues" ON dialogue_analysis_issues;
CREATE POLICY "select_own_analysis_issues" ON dialogue_analysis_issues FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_analysis_issues" ON dialogue_analysis_issues;
CREATE POLICY "insert_own_analysis_issues" ON dialogue_analysis_issues
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_analysis_issues" ON dialogue_analysis_issues;
CREATE POLICY "update_own_analysis_issues" ON dialogue_analysis_issues FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_analysis_issues" ON dialogue_analysis_issues;
CREATE POLICY "delete_own_analysis_issues" ON dialogue_analysis_issues FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_dialogue_analysis_issues_analysis_id ON dialogue_analysis_issues(analysis_id);
CREATE INDEX IF NOT EXISTS idx_dialogue_analysis_issues_user_id ON dialogue_analysis_issues(user_id);
CREATE INDEX IF NOT EXISTS idx_dialogue_analysis_issues_type ON dialogue_analysis_issues(issue_type);
