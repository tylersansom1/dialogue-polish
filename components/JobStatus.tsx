import { Loader2, CheckCircle2, XCircle, Clock, AlertCircle } from 'lucide-react';
import type { ProcessingJob } from '@/types/database';

interface JobStatusProps {
  job: ProcessingJob | null;
}

export default function JobStatus({ job }: JobStatusProps) {
  if (!job) return null;

  const config: Record<ProcessingJob['status'], { icon: typeof Clock; label: string; color: string; bg: string; border: string; spin?: boolean }> = {
    uploaded: { icon: Clock, label: 'File uploaded', color: 'text-neutral-400', bg: 'bg-neutral-900/50', border: 'border-neutral-800' },
    queued: { icon: Clock, label: 'Queued — waiting for worker', color: 'text-amber-400', bg: 'bg-amber-950/30', border: 'border-amber-900/50' },
    processing: { icon: Loader2, label: 'Processing…', color: 'text-blue-400', bg: 'bg-blue-950/30', border: 'border-blue-900/50', spin: true },
    completed: { icon: CheckCircle2, label: 'Processing complete', color: 'text-green-400', bg: 'bg-green-950/30', border: 'border-green-900/50' },
    failed: { icon: XCircle, label: 'Processing failed', color: 'text-red-400', bg: 'bg-red-950/30', border: 'border-red-900/50' },
  };

  const c = config[job.status] ?? config.uploaded;
  const Icon = c.icon;

  return (
    <div className={`rounded-lg border ${c.border} ${c.bg} px-4 py-3`}>
      <div className="flex items-center gap-2.5">
        <Icon size={18} className={`${c.color} ${c.spin ? 'animate-spin' : ''}`} />
        <span className={`text-sm font-medium ${c.color}`}>{c.label}</span>
        {job.status === 'processing' && job.progress > 0 && (
          <span className="text-xs tabular-nums text-neutral-500 ml-auto">{job.progress}%</span>
        )}
      </div>

      {job.status === 'processing' && job.progress > 0 && (
        <div className="mt-2 h-1 rounded-full bg-neutral-800 overflow-hidden">
          <div
            className="h-full bg-blue-500 transition-all duration-500"
            style={{ width: `${job.progress}%` }}
          />
        </div>
      )}

      {job.status === 'failed' && job.error_message && (
        <div className="mt-2 flex items-start gap-2">
          <AlertCircle size={14} className="text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-red-300/80 break-words">{job.error_message}</p>
        </div>
      )}

      {job.status === 'queued' && (
        <p className="mt-1.5 text-xs text-neutral-500">
          The audio worker will pick up this job automatically. If you haven't deployed the worker, see the worker setup instructions.
        </p>
      )}
    </div>
  );
}
