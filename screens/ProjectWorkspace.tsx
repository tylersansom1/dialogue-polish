import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/context/AuthContext';
import { supabase, STORAGE_BUCKET } from '@/lib/supabase';
import type { Project, AudioFile, ProcessingJob, WaveformPeak, DialogueAnalysis, DialogueAnalysisIssue } from '@/types/database';
import { ArrowLeft, Download, Loader2, Wand2, Activity } from 'lucide-react';
import UploadZone from '@/components/UploadZone';
import FileMetadata from '@/components/FileMetadata';
import AudioPlayer from '@/components/AudioPlayer';
import JobStatus from '@/components/JobStatus';
import AnalysisReport from '@/components/AnalysisReport';

interface ProjectWorkspaceProps {
  projectId: string;
  onBack: () => void;
}

export default function ProjectWorkspace({ projectId, onBack }: ProjectWorkspaceProps) {
  const { user } = useAuth();
  const [project, setProject] = useState<Project | null>(null);
  const [originalFile, setOriginalFile] = useState<AudioFile | null>(null);
  const [processedFile, setProcessedFile] = useState<AudioFile | null>(null);
  const [job, setJob] = useState<ProcessingJob | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);
  const [processedUrl, setProcessedUrl] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Analysis state
  const [analysis, setAnalysis] = useState<DialogueAnalysis | null>(null);
  const [analysisIssues, setAnalysisIssues] = useState<DialogueAnalysisIssue[]>([]);
  const [analysisJob, setAnalysisJob] = useState<ProcessingJob | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [seekTo, setSeekTo] = useState<number | null>(null);
  const [analysisJobStale, setAnalysisJobStale] = useState(false);
  const [jobStale, setJobStale] = useState(false);

  // Fetch project and related data
  const fetchData = useCallback(async () => {
    const { data: projData, error: projError } = await supabase
      .from('projects')
      .select('*')
      .eq('id', projectId)
      .maybeSingle();

    if (projError || !projData) {
      setError('Project not found');
      setLoading(false);
      return;
    }
    setProject(projData);

    const { data: files } = await supabase
      .from('audio_files')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: true });

    const orig = files?.find((f) => f.type === 'original') ?? null;
    const proc = files?.find((f) => f.type === 'processed') ?? null;
    setOriginalFile(orig);
    setProcessedFile(proc);

    const { data: jobs } = await supabase
      .from('processing_jobs')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false });

    const latestJob = jobs?.[0] ?? null;
    setJob(latestJob);

    // Fetch analysis data for the original file
    if (orig) {
      const { data: analyses } = await supabase
        .from('dialogue_analyses')
        .select('*')
        .eq('audio_file_id', orig.id)
        .order('created_at', { ascending: false })
        .limit(1);

      const latestAnalysis = analyses?.[0] ?? null;
      setAnalysis(latestAnalysis);

      if (latestAnalysis) {
        const { data: issueData } = await supabase
          .from('dialogue_analysis_issues')
          .select('*')
          .eq('analysis_id', latestAnalysis.id)
          .order('start_time', { ascending: true, nullsFirst: false });

        setAnalysisIssues(issueData ?? []);
      } else {
        setAnalysisIssues([]);
      }

      // Check for active analysis job
      const { data: analysisJobs } = await supabase
        .from('processing_jobs')
        .select('*')
        .eq('project_id', projectId)
        .eq('source_audio_file_id', orig.id)
        .like('processing_version', 'analysis%')
        .order('created_at', { ascending: false })
        .limit(1);

      const latestAnalysisJob = analysisJobs?.[0] ?? null;
      setAnalysisJob(latestAnalysisJob);
      setAnalyzing(latestAnalysisJob != null && (latestAnalysisJob.status === 'queued' || latestAnalysisJob.status === 'processing'));
    } else {
      setAnalysis(null);
      setAnalysisIssues([]);
      setAnalysisJob(null);
    }

    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Generate signed URLs for audio playback
  useEffect(() => {
    if (originalFile) {
      supabase.storage
        .from(STORAGE_BUCKET)
        .createSignedUrl(originalFile.storage_path, 3600)
        .then(({ data, error }) => {
          if (error) {
            setOriginalUrl(null);
          } else {
            setOriginalUrl(data?.signedUrl ?? null);
          }
        });
    } else {
      setOriginalUrl(null);
    }
  }, [originalFile]);

  useEffect(() => {
    if (processedFile) {
      supabase.storage
        .from(STORAGE_BUCKET)
        .createSignedUrl(processedFile.storage_path, 3600)
        .then(({ data, error }) => {
          if (error) {
            setProcessedUrl(null);
          } else {
            setProcessedUrl(data?.signedUrl ?? null);
          }
        });
    } else {
      setProcessedUrl(null);
    }
  }, [processedFile]);

  // Poll job status while processing
  useEffect(() => {
    if (job && (job.status === 'processing' || job.status === 'queued')) {
      const staleTimeout = setTimeout(() => {
        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
        setProcessing(false);
        setJobStale(true);
      }, 120000);

      pollRef.current = setInterval(async () => {
        const { data: updatedJob } = await supabase
          .from('processing_jobs')
          .select('*')
          .eq('id', job.id)
          .maybeSingle();

        if (updatedJob) {
          setJob(updatedJob);

          if (updatedJob.status === 'completed') {
            const { data: files } = await supabase
              .from('audio_files')
              .select('*')
              .eq('project_id', projectId)
              .order('created_at', { ascending: true });

            setProcessedFile(files?.find((f) => f.type === 'processed') ?? null);
            setOriginalFile(files?.find((f) => f.type === 'original') ?? null);
          }

          if (updatedJob.status === 'completed' || updatedJob.status === 'failed') {
            clearTimeout(staleTimeout);
            if (pollRef.current) {
              clearInterval(pollRef.current);
              pollRef.current = null;
            }
            setProcessing(false);
          }
        }
      }, 2000);

      return () => {
        clearTimeout(staleTimeout);
        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      };
    }
  }, [job?.id, job?.status, projectId]);

  // Poll analysis job status
  useEffect(() => {
    if (!analysisJob || (analysisJob.status !== 'processing' && analysisJob.status !== 'queued')) return;

    const staleTimeout = setTimeout(() => {
      clearInterval(pollInterval);
      setAnalyzing(false);
      setAnalysisJobStale(true);
    }, 120000);

    const pollInterval = setInterval(async () => {
      const { data: updatedJob } = await supabase
        .from('processing_jobs')
        .select('*')
        .eq('id', analysisJob.id)
        .maybeSingle();

      if (updatedJob) {
        setAnalysisJob(updatedJob);

        if (updatedJob.status === 'completed') {
          if (originalFile) {
            const { data: analyses } = await supabase
              .from('dialogue_analyses')
              .select('*')
              .eq('audio_file_id', originalFile.id)
              .order('created_at', { ascending: false })
              .limit(1);

            const latestAnalysis = analyses?.[0] ?? null;
            setAnalysis(latestAnalysis);

            if (latestAnalysis) {
              const { data: issueData } = await supabase
                .from('dialogue_analysis_issues')
                .select('*')
                .eq('analysis_id', latestAnalysis.id)
                .order('start_time', { ascending: true, nullsFirst: false });

              setAnalysisIssues(issueData ?? []);
            }
          }
        }

        if (updatedJob.status === 'completed' || updatedJob.status === 'failed') {
          clearTimeout(staleTimeout);
          clearInterval(pollInterval);
          setAnalyzing(false);
        }
      }
    }, 2000);

    return () => {
      clearTimeout(staleTimeout);
      clearInterval(pollInterval);
    };
  }, [analysisJob?.id, analysisJob?.status, originalFile]);

  const handleAnalyze = async () => {
    if (!originalFile) return;
    setAnalyzing(true);
    setError(null);

    try {
      const { data: newJob, error: jobError } = await supabase
        .from('processing_jobs')
        .insert({
          project_id: projectId,
          source_audio_file_id: originalFile.id,
          status: 'queued',
          processing_version: 'analysis-2.0.0',
        })
        .select()
        .maybeSingle();

      if (jobError || !newJob) throw jobError ?? new Error('Failed to create analysis job');

      setAnalysisJob(newJob);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Analysis failed to start');
      setAnalyzing(false);
    }
  };

  const handleSeekToIssue = (time: number) => {
    setSeekTo(time);
  };

  const handleFileUpload = async (file: File) => {
    if (!user) return;
    setUploading(true);
    setUploadProgress(0);
    setError(null);

    try {
      const fileName = `${Date.now()}_${file.name}`;
      const filePath = `${user.id}/${projectId}/${fileName}`;

      // Upload via XMLHttpRequest for real progress events
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const { data: { session } } = await supabase.auth.getSession();
      const encodedPath = [user.id, projectId, fileName]
        .map((segment) => encodeURIComponent(segment))
        .join('/');
      const uploadUrl = `${supabaseUrl}/storage/v1/object/${STORAGE_BUCKET}/${encodedPath}`;

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', uploadUrl);
        xhr.setRequestHeader('Authorization', `Bearer ${session?.access_token}`);
        xhr.setRequestHeader('apikey', import.meta.env.VITE_SUPABASE_ANON_KEY);
        xhr.setRequestHeader('Content-Type', 'audio/wav');
        xhr.setRequestHeader('x-upsert', 'false');

        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            setUploadProgress(Math.round((e.loaded / e.total) * 100));
          }
        };

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve();
          } else {
            let detail = `Upload failed (${xhr.status})`;
            try {
              const body = JSON.parse(xhr.responseText);
              if (body.message) detail = `Upload failed: ${body.message}`;
            } catch { /* response wasn't JSON */ }
            reject(new Error(detail));
          }
        };

        xhr.onerror = () => reject(new Error('Network error during upload'));
        xhr.send(file);
      });

      setUploadProgress(100);

      // Create audio_files record
      const { data: audioFile, error: dbError } = await supabase
        .from('audio_files')
        .insert({
          project_id: projectId,
          user_id: user.id,
          original_filename: file.name,
          storage_path: filePath,
          type: 'original',
          file_size: file.size,
        })
        .select()
        .maybeSingle();

      if (dbError || !audioFile) throw dbError ?? new Error('Failed to create file record');

      // Call extract-metadata edge function (reuse session from upload)
      const response = await fetch(`${supabaseUrl}/functions/v1/extract-metadata`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ audioFileId: audioFile.id }),
      });

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        throw new Error(errBody.error || 'Failed to extract metadata');
      }

      // Refresh data
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  };

  const handleProcess = async () => {
    if (!originalFile) return;
    setProcessing(true);
    setError(null);

    try {
      // Create a processing job
      const { data: newJob, error: jobError } = await supabase
        .from('processing_jobs')
        .insert({
          project_id: projectId,
          source_audio_file_id: originalFile.id,
          status: 'queued',
          processing_version: 'phase1-dsp',
        })
        .select()
        .maybeSingle();

      if (jobError || !newJob) throw jobError ?? new Error('Failed to create job');

      setJob(newJob);

      // Try the edge function processor (works for small files)
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const { data: { session } } = await supabase.auth.getSession();

      const response = await fetch(`${supabaseUrl}/functions/v1/process-dialogue`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ jobId: newJob.id }),
      });

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        // If it's a file-too-large error, the job stays queued for the external worker
        if (response.status === 413) {
          // Job is already queued; the external worker will pick it up
          setJob({ ...newJob, status: 'queued', error_message: errBody.error });
        } else {
          throw new Error(errBody.error || 'Processing request failed');
        }
      } else {
        // Processing started, poll for completion
        await fetchData();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Processing failed');
      setProcessing(false);
    }
  };

  const handleDownload = async () => {
    if (!processedFile || !processedUrl) return;
    try {
      const response = await fetch(processedUrl);
      if (!response.ok) throw new Error(`Download failed (${response.status})`);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = processedFile.original_filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(blobUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-neutral-950 flex items-center justify-center">
        <Loader2 size={24} className="animate-spin text-neutral-600" />
      </div>
    );
  }

  const canProcess = originalFile && !processing && (!job || job.status === 'completed' || job.status === 'failed');
  const hasProcessed = processedFile && job?.status === 'completed';

  return (
    <div className="min-h-screen bg-neutral-950">
      <header className="border-b border-neutral-800/80">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center gap-4">
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 text-sm text-neutral-500 hover:text-neutral-300 transition-colors"
          >
            <ArrowLeft size={16} />
            Projects
          </button>
          <span className="text-neutral-700">/</span>
          <h1 className="text-lg font-medium text-neutral-200 truncate">{project?.name}</h1>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8 space-y-6">
        {error && (
          <p className="text-sm text-red-400 bg-red-950/40 border border-red-900/50 rounded-md px-3 py-2">
            {error}
          </p>
        )}

        {/* Upload Zone — shown when no original file yet */}
        {!originalFile && (
          <UploadZone
            onFileSelected={handleFileUpload}
            uploading={uploading}
            uploadProgress={uploadProgress}
          />
        )}

        {/* File Metadata */}
        {originalFile && <FileMetadata file={originalFile} />}

        {/* Original Audio Player */}
        {originalFile && (
          <div className="space-y-1">
            <AudioPlayer
              src={originalUrl}
              peaks={originalFile.waveform_data as WaveformPeak[] | null}
              label="Original"
              seekTo={seekTo}
              onSeekComplete={() => setSeekTo(null)}
            />
          </div>
        )}

        {/* Analyze + Process Buttons */}
        {originalFile && (
          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={handleAnalyze}
              disabled={analyzing || !originalFile}
              className="flex items-center gap-2 rounded-md border border-neutral-600 px-5 py-2.5 text-sm font-medium text-neutral-200 hover:bg-neutral-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {analyzing ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Activity size={16} />
              )}
              {analyzing ? 'Analyzing…' : analysis ? 'Re-analyze' : 'Analyze Dialogue'}
            </button>
            <button
              onClick={handleProcess}
              disabled={!canProcess}
              className="flex items-center gap-2 rounded-md bg-neutral-100 px-5 py-2.5 text-sm font-medium text-neutral-900 hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {processing ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Wand2 size={16} />
              )}
              {processing ? 'Processing…' : hasProcessed ? 'Reprocess' : 'Process Dialogue'}
            </button>
            {originalFile && !processing && !analyzing && (
              <button
                onClick={() => {
                  if (originalFile) {
                    const input = document.createElement('input');
                    input.type = 'file';
                    input.accept = '.wav,audio/wav';
                    input.onchange = (e) => {
                      const file = (e.target as HTMLInputElement).files?.[0];
                      if (file) handleFileUpload(file);
                    };
                    input.click();
                  }
                }}
                className="text-sm text-neutral-500 hover:text-neutral-300 transition-colors"
              >
                Replace file
              </button>
            )}
          </div>
        )}

        {/* Analysis Job Status */}
        {analysisJob && (analysisJob.status === 'processing' || analysisJob.status === 'queued') && (
          <JobStatus job={analysisJob} />
        )}

        {/* Stale Analysis Job Warning */}
        {analysisJobStale && (
          <div className="text-sm text-amber-400 bg-amber-950/40 border border-amber-900/50 rounded-md px-4 py-3 space-y-2">
            <p>The analysis seems to be stuck. The worker may not be running or may need to be redeployed with the latest code that includes Python analysis support.</p>
            <button
              onClick={() => {
                setAnalysisJobStale(false);
                setAnalysisJob(null);
                setAnalyzing(false);
              }}
              className="text-xs text-amber-300 hover:text-amber-200 underline"
            >
              Dismiss and try again
            </button>
          </div>
        )}

        {/* Stale Processing Job Warning */}
        {jobStale && (
          <div className="text-sm text-amber-400 bg-amber-950/40 border border-amber-900/50 rounded-md px-4 py-3 space-y-2">
            <p>The processing job seems to be stuck. The worker may not be running. Check that it is deployed and has FFmpeg installed.</p>
            <button
              onClick={() => {
                setJobStale(false);
                setJob(null);
                setProcessing(false);
              }}
              className="text-xs text-amber-300 hover:text-amber-200 underline"
            >
              Dismiss and try again
            </button>
          </div>
        )}

        {/* Analysis Report */}
        {analysis && analysis.status === 'completed' && (
          <AnalysisReport
            analysis={analysis}
            issues={analysisIssues}
            duration={originalFile?.duration_seconds ?? null}
            onSeek={handleSeekToIssue}
          />
        )}

        {/* Job Status */}
        {job && <JobStatus job={job} />}

        {/* Processed Audio Player */}
        {hasProcessed && processedFile && (
          <div className="space-y-3">
            <AudioPlayer
              src={processedUrl}
              peaks={processedFile.waveform_data as WaveformPeak[] | null}
              label="Processed"
            />
            <button
              onClick={handleDownload}
              className="flex items-center gap-2 rounded-md border border-neutral-700 px-4 py-2 text-sm font-medium text-neutral-200 hover:bg-neutral-800 transition-colors"
            >
              <Download size={16} />
              Download WAV
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
