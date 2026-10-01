/*
# Dialogue Polish — Core Database Schema

## Purpose
Establish the persistent data model for a professional film dialogue processing application.
Users create projects, upload WAV files, and processing jobs transform those files server-side.

## New Tables

### projects
- `id` (uuid, primary key) — unique project identifier
- `user_id` (uuid, not null, defaults to auth.uid()) — owner of the project, references auth.users
- `name` (text, not null) — user-given project name
- `created_at` (timestamptz) — creation timestamp
- `updated_at` (timestamptz) — last modification timestamp

### audio_files
- `id` (uuid, primary key) — unique file identifier
- `project_id` (uuid, not null) — references projects, cascade delete
- `user_id` (uuid, not null, defaults to auth.uid()) — owner, references auth.users
- `original_filename` (text, not null) — the filename as uploaded
- `storage_path` (text, not null) — path within the audio-files storage bucket
- `type` (text, not null) — 'original' or 'processed'
- `duration_seconds` (numeric) — real extracted duration
- `sample_rate` (integer) — Hz, e.g. 48000
- `bit_depth` (integer) — bits per sample, e.g. 24
- `channels` (integer) — 1 (mono) or 2 (stereo)
- `file_size` (bigint) — bytes
- `waveform_data` (jsonb) — array of {min, max} peak pairs for waveform display
- `created_at` (timestamptz) — upload/creation timestamp

### processing_jobs
- `id` (uuid, primary key) — unique job identifier
- `project_id` (uuid, not null) — references projects, cascade delete
- `user_id` (uuid, not null, defaults to auth.uid()) — owner, references auth.users
- `source_audio_file_id` (uuid) — references audio_files, the input file
- `output_audio_file_id` (uuid) — references audio_files, the processed result
- `status` (text, not null, default 'uploaded') — one of: uploaded, queued, processing, completed, failed
- `progress` (integer, default 0) — 0-100
- `error_message` (text) — real error details on failure
- `processing_version` (text, not null, default 'phase1-dsp') — identifies which processor ran
- `created_at` (timestamptz) — job creation time
- `started_at` (timestamptz) — when processing began
- `completed_at` (timestamptz) — when processing finished

## Storage
- Creates a private storage bucket named 'audio-files' for WAV uploads and processed outputs.
- Files are stored privately; access is via signed URLs only.

## Security
- RLS enabled on all three tables.
- Owner-scoped CRUD policies on every table (user_id = auth.uid()).
- Storage policies on the audio-files bucket: users can upload, read, and delete only their own files (path starts with their user ID).
- A status constraint ensures processing_jobs.status only accepts valid values.

## Important Notes
1. The user_id columns default to auth.uid() so frontend inserts that omit user_id still satisfy RLS WITH CHECK.
2. processing_jobs is designed so one source file can have multiple jobs (multiple processing versions).
3. audio_files.type is constrained to 'original' or 'processed'.
*/

CREATE TABLE IF NOT EXISTS projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_projects" ON projects;
CREATE POLICY "select_own_projects" ON projects FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_projects" ON projects;
CREATE POLICY "insert_own_projects" ON projects
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_projects" ON projects;
CREATE POLICY "update_own_projects" ON projects FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_projects" ON projects;
CREATE POLICY "delete_own_projects" ON projects FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS audio_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  original_filename text NOT NULL,
  storage_path text NOT NULL,
  type text NOT NULL CHECK (type IN ('original', 'processed')),
  duration_seconds numeric,
  sample_rate integer,
  bit_depth integer,
  channels integer,
  file_size bigint,
  waveform_data jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE audio_files ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_audio_files" ON audio_files;
CREATE POLICY "select_own_audio_files" ON audio_files FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_audio_files" ON audio_files;
CREATE POLICY "insert_own_audio_files" ON audio_files
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_audio_files" ON audio_files;
CREATE POLICY "update_own_audio_files" ON audio_files FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_audio_files" ON audio_files;
CREATE POLICY "delete_own_audio_files" ON audio_files FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS processing_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  source_audio_file_id uuid REFERENCES audio_files(id) ON DELETE SET NULL,
  output_audio_file_id uuid REFERENCES audio_files(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded', 'queued', 'processing', 'completed', 'failed')),
  progress integer NOT NULL DEFAULT 0,
  error_message text,
  processing_version text NOT NULL DEFAULT 'phase1-dsp',
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz
);

ALTER TABLE processing_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_jobs" ON processing_jobs;
CREATE POLICY "select_own_jobs" ON processing_jobs FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_jobs" ON processing_jobs;
CREATE POLICY "insert_own_jobs" ON processing_jobs
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_jobs" ON processing_jobs;
CREATE POLICY "update_own_jobs" ON processing_jobs FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_jobs" ON processing_jobs;
CREATE POLICY "delete_own_jobs" ON processing_jobs FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- Updated_at trigger for projects
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS projects_updated_at ON projects;
CREATE TRIGGER projects_updated_at BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id);
CREATE INDEX IF NOT EXISTS idx_audio_files_project_id ON audio_files(project_id);
CREATE INDEX IF NOT EXISTS idx_audio_files_user_id ON audio_files(user_id);
CREATE INDEX IF NOT EXISTS idx_processing_jobs_project_id ON processing_jobs(project_id);
CREATE INDEX IF NOT EXISTS idx_processing_jobs_user_id ON processing_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_processing_jobs_status ON processing_jobs(status);
CREATE INDEX IF NOT EXISTS idx_processing_jobs_source_audio_file_id ON processing_jobs(source_audio_file_id);

-- Insert the storage bucket (idempotent)
INSERT INTO storage.buckets (id, name, public)
VALUES ('audio-files', 'audio-files', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies: users can manage files under their own user-id prefix
DROP POLICY IF EXISTS "Users can upload own audio files" ON storage.objects;
CREATE POLICY "Users can upload own audio files" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'audio-files' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "Users can read own audio files" ON storage.objects;
CREATE POLICY "Users can read own audio files" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'audio-files' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "Users can update own audio files" ON storage.objects;
CREATE POLICY "Users can update own audio files" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'audio-files' AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id = 'audio-files' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "Users can delete own audio files" ON storage.objects;
CREATE POLICY "Users can delete own audio files" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'audio-files' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Allow the service role to read/write any audio file (for edge functions and the external worker)
DROP POLICY IF EXISTS "Service role can manage all audio files" ON storage.objects;
CREATE POLICY "Service role can manage all audio files" ON storage.objects
  FOR ALL TO service_role
  USING (bucket_id = 'audio-files')
  WITH CHECK (bucket_id = 'audio-files');
