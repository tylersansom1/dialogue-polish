export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || isNaN(seconds)) return '--';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export function formatFileSize(bytes: number | null | undefined): string {
  if (bytes == null || isNaN(bytes)) return '--';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  return `${value.toFixed(2)} ${units[unitIndex]}`;
}

export function formatSampleRate(hz: number | null | undefined): string {
  if (hz == null) return '--';
  return `${(hz / 1000).toFixed(hz % 1000 === 0 ? 0 : 1)} kHz`;
}

export function formatBitDepth(bits: number | null | undefined): string {
  if (bits == null) return '--';
  return `${bits}-bit`;
}

export function formatChannels(channels: number | null | undefined): string {
  if (channels == null) return '--';
  if (channels === 1) return 'Mono';
  if (channels === 2) return 'Stereo';
  return `${channels} channels`;
}

export function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return '--';
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatLUFS(lufs: number | null | undefined): string {
  if (lufs == null) return '--';
  return `${lufs.toFixed(1)} LUFS`;
}

export function formatdBTP(dbtp: number | null | undefined): string {
  if (dbtp == null) return '--';
  return `${dbtp.toFixed(1)} dBTP`;
}

export function formatdB(db: number | null | undefined, suffix = 'dB'): string {
  if (db == null) return '--';
  return `${db.toFixed(1)} ${suffix}`;
}

export function formatHz(hz: number | null | undefined): string {
  if (hz == null) return '--';
  if (hz >= 1000) return `${(hz / 1000).toFixed(hz % 1000 === 0 ? 0 : 1)} kHz`;
  return `${hz.toFixed(0)} Hz`;
}

export function formatPercent(pct: number | null | undefined): string {
  if (pct == null) return '--';
  return `${pct.toFixed(1)}%`;
}

export function formatTimecode(seconds: number | null | undefined): string {
  if (seconds == null || isNaN(seconds)) return '--';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${s.toFixed(3).padStart(6, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${s.toFixed(3).padStart(6, '0')}`;
}

export function formatTimeRange(start: number | null | undefined, end: number | null | undefined): string {
  if (start == null && end == null) return '--';
  return `${formatTimecode(start)} - ${formatTimecode(end)}`;
}

export const severityLabels: Record<string, string> = {
  info: 'Info',
  mild: 'Mild',
  moderate: 'Moderate',
  significant: 'Significant',
};

export const severityColors: Record<string, string> = {
  info: 'text-neutral-400 bg-neutral-800/60 border-neutral-700',
  mild: 'text-yellow-400 bg-yellow-950/40 border-yellow-900/50',
  moderate: 'text-orange-400 bg-orange-950/40 border-orange-900/50',
  significant: 'text-red-400 bg-red-950/40 border-red-900/50',
};

export const issueTypeLabels: Record<string, string> = {
  clipping: 'Clipping',
  near_clipping: 'Near-Clipping',
  low_dialogue: 'Low Dialogue',
  high_dialogue: 'High Dialogue',
  level_jump: 'Level Jump',
  high_noise: 'High Noise',
  hum: 'Hum',
  rumble: 'Rumble',
  harshness: 'Harshness',
  sibilance: 'Sibilance',
  resonance: 'Resonance',
  dc_offset: 'DC Offset',
  channel_imbalance: 'Channel Imbalance',
  phase_problem: 'Phase Problem',
};

export const issueTypeColors: Record<string, string> = {
  clipping: '#ef4444',
  near_clipping: '#f97316',
  low_dialogue: '#3b82f6',
  high_dialogue: '#eab308',
  level_jump: '#a855f7',
  high_noise: '#6b7280',
  hum: '#22d3ee',
  rumble: '#14b8a6',
  harshness: '#f43f5e',
  sibilance: '#ec4899',
  resonance: '#8b5cf6',
  dc_offset: '#64748b',
  channel_imbalance: '#06b6d4',
  phase_problem: '#dc2626',
};
