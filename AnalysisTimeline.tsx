import type { DialogueAnalysisIssue } from '@/types/database';
import { issueTypeColors, issueTypeLabels, formatTimecode } from '@/lib/format';
import { formatDuration } from '@/lib/format';

interface AnalysisTimelineProps {
  issues: DialogueAnalysisIssue[];
  duration: number | null;
  onSeek: (time: number) => void;
}

export default function AnalysisTimeline({ issues, duration, onSeek }: AnalysisTimelineProps) {
  const totalDuration = duration && duration > 0 ? duration : 1;

  const pointIssues = issues.filter((i) => i.start_time != null);
  const rangeIssues = issues.filter(
    (i) => i.start_time != null && i.end_time != null && i.end_time - i.start_time > 0.5,
  );

  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-4">
      <h3 className="text-xs font-medium uppercase tracking-wider text-neutral-500 mb-3">Issue Timeline</h3>

      <div className="relative h-20 w-full">
        {/* Base bar */}
        <div className="absolute top-1/2 left-0 right-0 h-0.5 bg-neutral-700 -translate-y-1/2" />

        {/* Range regions */}
        {rangeIssues.map((issue, idx) => {
          const start = ((issue.start_time ?? 0) / totalDuration) * 100;
          const width = ((issue.end_time ?? 0) - (issue.start_time ?? 0)) / totalDuration * 100;
          const color = issueTypeColors[issue.issue_type] ?? '#6b7280';
          return (
            <div
              key={`range-${idx}`}
              className="absolute top-1/2 -translate-y-1/2 rounded-sm opacity-40 hover:opacity-70 transition-opacity cursor-pointer"
              style={{
                left: `${start}%`,
                width: `${Math.max(width, 0.5)}%`,
                height: '24px',
                backgroundColor: color,
              }}
              onClick={() => onSeek(issue.start_time ?? 0)}
              title={`${issueTypeLabels[issue.issue_type]}: ${formatTimecode(issue.start_time)}`}
            />
          );
        })}

        {/* Point markers */}
        {pointIssues.map((issue, idx) => {
          const pos = ((issue.start_time ?? 0) / totalDuration) * 100;
          const color = issueTypeColors[issue.issue_type] ?? '#6b7280';
          return (
            <div
              key={`point-${idx}`}
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 cursor-pointer group"
              style={{ left: `${pos}%` }}
              onClick={() => onSeek(issue.start_time ?? 0)}
            >
              <div
                className="w-2 h-2 rounded-full border border-neutral-900 group-hover:scale-150 transition-transform"
                style={{ backgroundColor: color }}
              />
              <div className="absolute left-1/2 -translate-x-1/2 -top-8 hidden group-hover:block z-10 whitespace-nowrap rounded bg-neutral-800 border border-neutral-700 px-2 py-1 text-xs text-neutral-300 pointer-events-none">
                {issueTypeLabels[issue.issue_type]}
                <span className="text-neutral-500 ml-1">{formatTimecode(issue.start_time)}</span>
              </div>
            </div>
          );
        })}

        {/* Time labels */}
        <div className="absolute -bottom-1 left-0 text-[10px] text-neutral-600 tabular-nums">0:00</div>
        <div className="absolute -bottom-1 right-0 text-[10px] text-neutral-600 tabular-nums">
          {formatDuration(totalDuration)}
        </div>
      </div>
    </div>
  );
}
