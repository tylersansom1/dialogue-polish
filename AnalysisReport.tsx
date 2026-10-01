import { useState } from 'react';
import type { DialogueAnalysis, DialogueAnalysisIssue, AnalysisModuleData } from '@/types/database';
import {
  formatLUFS, formatdBTP, formatdB, formatHz, formatPercent, formatTimecode, formatTimeRange,
  severityLabels, severityColors, issueTypeLabels, issueTypeColors, formatDuration,
} from '@/lib/format';
import AnalysisTimeline from './AnalysisTimeline';
import {
  Activity, AlertTriangle, AudioWaveform, BarChart3, Gauge,
  Radio, Volume2, Waves, Zap, CheckCircle2, XCircle, ChevronDown, ChevronRight,
} from 'lucide-react';

interface AnalysisReportProps {
  analysis: DialogueAnalysis;
  issues: DialogueAnalysisIssue[];
  duration: number | null;
  onSeek: (time: number) => void;
}

interface SectionProps {
  title: string;
  icon: typeof Activity;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

function Section({ title, icon: Icon, children, defaultOpen = true }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2.5 px-4 py-3 hover:bg-neutral-800/40 transition-colors"
      >
        <Icon size={16} className="text-neutral-400" />
        <span className="text-sm font-medium text-neutral-200">{title}</span>
        {open ? <ChevronDown size={14} className="ml-auto text-neutral-500" /> : <ChevronRight size={14} className="ml-auto text-neutral-500" />}
      </button>
      {open && <div className="px-4 pb-4 pt-1 space-y-3">{children}</div>}
    </div>
  );
}

function Metric({ label, value, unit }: { label: string; value: string | number | null; unit?: string }) {
  return (
    <div>
      <dt className="text-xs text-neutral-600 mb-0.5">{label}</dt>
      <dd className="text-sm text-neutral-300 tabular-nums">
        {value ?? '--'}
        {unit && value != null && <span className="text-neutral-600 ml-1">{unit}</span>}
      </dd>
    </div>
  );
}

function ModuleStatus({ status, error }: { status?: string; error?: string }) {
  if (status === 'failed') {
    return (
      <div className="flex items-center gap-2 text-xs text-amber-400 mt-1">
        <AlertTriangle size={12} />
        <span>This analysis module could not be completed{error ? `: ${error}` : ''}</span>
      </div>
    );
  }
  if (status === 'skipped') {
    return (
      <div className="flex items-center gap-2 text-xs text-neutral-600 mt-1">
        <span>This module was skipped{error ? `: ${error}` : ''}</span>
      </div>
    );
  }
  return null;
}

function getModuleData(modules: AnalysisModuleData | null, key: string): Record<string, unknown> | undefined {
  return modules?.[key]?.data;
}

const bandLabels: Record<string, string> = {
  sub_rumble: 'Sub / Rumble',
  low_bass: 'Low Bass',
  low_mids: 'Low Mids',
  mids: 'Mids',
  presence: 'Presence',
  upper_presence: 'Upper Presence',
  air: 'Air',
};

export default function AnalysisReport({ analysis, issues, duration, onSeek }: AnalysisReportProps) {
  const modules = analysis.analysis_data_json;
  const [selectedIssue, setSelectedIssue] = useState<string | null>(null);

  const sortedIssues = [...issues].sort((a, b) => (a.start_time ?? 0) - (b.start_time ?? 0));

  // Group issues by type for counting
  const issueCounts: Record<string, number> = {};
  for (const issue of issues) {
    issueCounts[issue.issue_type] = (issueCounts[issue.issue_type] ?? 0) + 1;
  }

  // Get module data
  const loudnessData = getModuleData(modules, 'loudness');
  const peakData = getModuleData(modules, 'peaks');
  const levelData = getModuleData(modules, 'level_consistency');
  const noiseData = getModuleData(modules, 'noise_floor');
  const humData = getModuleData(modules, 'hum');
  const spectrumData = getModuleData(modules, 'spectrum');
  const rumbleData = getModuleData(modules, 'rumble');
  const harshData = getModuleData(modules, 'harshness_sibilance');
  const resonanceData = getModuleData(modules, 'resonance');
  const dynamicsData = getModuleData(modules, 'dynamics');
  const silenceData = getModuleData(modules, 'silence');
  const dcData = getModuleData(modules, 'dc_offset');
  const phaseData = getModuleData(modules, 'phase');
  const speechData = getModuleData(modules, 'speech');
  const fileInfoData = getModuleData(modules, 'file_info');

  const detectedHum = humData?.detected_hum as { frequency?: number; confidence?: number; elevated_harmonics_count?: number } | null;
  const bands = spectrumData?.bands as Record<string, number> | undefined;
  const resonances = resonanceData?.resonances as Array<{ center_frequency_hz: number; bandwidth_hz: number; strength: number }> | undefined;
  const silenceRegions = silenceData?.silence_regions as Array<{ start: number; end: number }> | undefined;
  const nearSilenceRegions = silenceData?.near_silence_regions as Array<{ start: number; end: number }> | undefined;
  const speechRegions = speechData?.speech_regions as Array<{ start: number; end: number }> | undefined;
  const lowDialogueRegions = levelData?.low_dialogue_regions as Array<{ start: number; end: number }> | undefined;
  const highDialogueRegions = levelData?.high_dialogue_regions as Array<{ start: number; end: number }> | undefined;
  const levelJumpRegions = levelData?.level_jump_regions as Array<{ start: number; end: number }> | undefined;
  const rumbleRegions = rumbleData?.rumble_regions as Array<{ start: number; end: number }> | undefined;
  const harshRegions = harshData?.harshness_regions as Array<{ start: number; end: number }> | undefined;
  const sibilanceRegions = harshData?.sibilance_regions as Array<{ start: number; end: number }> | undefined;
  const noisyRegions = noiseData?.noisy_regions as Array<{ start: number; end: number }> | undefined;

  return (
    <div className="space-y-4">
      {/* Summary Card */}
      <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-5">
        <div className="flex items-center gap-2 mb-4">
          <Activity size={16} className="text-neutral-400" />
          <h3 className="text-sm font-semibold text-neutral-200">Dialogue Analysis</h3>
          <span className="ml-auto text-xs text-neutral-600">v{analysis.analysis_version}</span>
        </div>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 mb-4">
          <Metric label="Integrated Loudness" value={analysis.integrated_lufs != null ? analysis.integrated_lufs.toFixed(1) : null} unit="LUFS" />
          <Metric label="True Peak" value={analysis.true_peak != null ? analysis.true_peak.toFixed(1) : null} unit="dBTP" />
          <Metric label="Noise Floor" value={analysis.estimated_noise_floor != null ? analysis.estimated_noise_floor.toFixed(1) : null} unit="dBFS" />
          <Metric label="Dynamic Range" value={analysis.dynamic_range != null ? analysis.dynamic_range.toFixed(1) : null} unit="dB" />
          <div>
            <dt className="text-xs text-neutral-600 mb-0.5">Clipping</dt>
            <dd className="text-sm text-neutral-300">
              {analysis.clipping_count === 0 || analysis.clipping_count == null ? (
                <span className="text-green-400">None</span>
              ) : (
                <span className="text-red-400">{analysis.clipping_count} events</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-neutral-600 mb-0.5">Hum</dt>
            <dd className="text-sm text-neutral-300">
              {detectedHum ? (
                <span className="text-cyan-400">{detectedHum.frequency} Hz detected</span>
              ) : (
                <span className="text-green-400">None detected</span>
              )}
            </dd>
          </div>
        </div>

        {analysis.summary_text && (
          <p className="text-sm text-neutral-400 leading-relaxed border-t border-neutral-800 pt-3">
            {analysis.summary_text}
          </p>
        )}
      </div>

      {/* Issue Timeline */}
      {sortedIssues.length > 0 && (
        <AnalysisTimeline
          issues={sortedIssues}
          duration={duration}
          onSeek={onSeek}
        />
      )}

      {/* LEVELS Section */}
      <Section title="Levels" icon={Volume2}>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
          <Metric label="Integrated LUFS" value={analysis.integrated_lufs != null ? analysis.integrated_lufs.toFixed(1) : null} unit="LUFS" />
          <Metric label="Loudness Range" value={analysis.loudness_range != null ? analysis.loudness_range.toFixed(1) : null} unit="LU" />
          <Metric label="Max Momentary" value={analysis.maximum_momentary_loudness != null ? analysis.maximum_momentary_loudness.toFixed(1) : null} unit="LUFS" />
          <Metric label="Max Short-Term" value={analysis.maximum_short_term_loudness != null ? analysis.maximum_short_term_loudness.toFixed(1) : null} unit="LUFS" />
          <Metric label="RMS Average" value={analysis.rms_average != null ? analysis.rms_average.toFixed(1) : null} unit="dBFS" />
          <Metric label="Level Variation" value={levelData?.variation_lu as number ?? null} unit="LU" />
        </dl>

        {lowDialogueRegions && lowDialogueRegions.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs text-neutral-600">Quiet dialogue sections ({lowDialogueRegions.length})</p>
            {lowDialogueRegions.slice(0, 8).map((r, i) => (
              <button
                key={i}
                onClick={() => onSeek(r.start)}
                className="block text-xs text-blue-400 hover:text-blue-300 tabular-nums"
              >
                {formatTimeRange(r.start, r.end)}
              </button>
            ))}
          </div>
        )}
        {highDialogueRegions && highDialogueRegions.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs text-neutral-600">Loud dialogue sections ({highDialogueRegions.length})</p>
            {highDialogueRegions.slice(0, 8).map((r, i) => (
              <button
                key={i}
                onClick={() => onSeek(r.start)}
                className="block text-xs text-yellow-400 hover:text-yellow-300 tabular-nums"
              >
                {formatTimeRange(r.start, r.end)}
              </button>
            ))}
          </div>
        )}
        {levelJumpRegions && levelJumpRegions.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs text-neutral-600">Sudden level changes ({levelJumpRegions.length})</p>
            {levelJumpRegions.slice(0, 8).map((r, i) => (
              <button
                key={i}
                onClick={() => onSeek(r.start)}
                className="block text-xs text-purple-400 hover:text-purple-300 tabular-nums"
              >
                {formatTimecode(r.start)}
              </button>
            ))}
          </div>
        )}
        <ModuleStatus status={modules?.level_consistency?.status} error={modules?.level_consistency?.error} />
      </Section>

      {/* NOISE Section */}
      <Section title="Noise" icon={Radio}>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
          <Metric label="Noise Floor" value={analysis.estimated_noise_floor != null ? analysis.estimated_noise_floor.toFixed(1) : null} unit="dBFS" />
          <Metric label="Noise Variation" value={noiseData?.noise_floor_variation_db as number ?? null} unit="dB" />
        </dl>

        {detectedHum && (
          <div className="space-y-1">
            <p className="text-xs text-neutral-600">
              Hum: <span className="text-cyan-400">{detectedHum.frequency} Hz</span>
              {' '}
              (confidence: {((detectedHum.confidence ?? 0) * 100).toFixed(0)}%,
              {' '}{detectedHum.elevated_harmonics_count ?? 0} harmonics)
            </p>
          </div>
        )}
        <ModuleStatus status={modules?.hum?.status} error={modules?.hum?.error} />

        {rumbleRegions && rumbleRegions.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs text-neutral-600">Rumble regions ({rumbleRegions.length})</p>
            {rumbleRegions.slice(0, 8).map((r, i) => (
              <button
                key={i}
                onClick={() => onSeek(r.start)}
                className="block text-xs text-teal-400 hover:text-teal-300 tabular-nums"
              >
                {formatTimeRange(r.start, r.end)}
              </button>
            ))}
          </div>
        )}
        <ModuleStatus status={modules?.rumble?.status} error={modules?.rumble?.error} />

        {noisyRegions && noisyRegions.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs text-neutral-600">Elevated noise sections ({noisyRegions.length})</p>
            {noisyRegions.slice(0, 5).map((r, i) => (
              <button
                key={i}
                onClick={() => onSeek(r.start)}
                className="block text-xs text-neutral-400 hover:text-neutral-300 tabular-nums"
              >
                {formatTimeRange(r.start, r.end)}
              </button>
            ))}
          </div>
        )}
        <ModuleStatus status={modules?.noise_floor?.status} error={modules?.noise_floor?.error} />
      </Section>

      {/* FREQUENCY Section */}
      <Section title="Frequency" icon={AudioWaveform}>
        {bands && (
          <div className="space-y-2">
            <p className="text-xs text-neutral-600">Spectral energy distribution</p>
            {Object.entries(bands).map(([band, pct]) => (
              <div key={band} className="flex items-center gap-3">
                <span className="text-xs text-neutral-400 w-28 flex-shrink-0">{bandLabels[band] ?? band}</span>
                <div className="flex-1 h-2 rounded-full bg-neutral-800 overflow-hidden">
                  <div
                    className="h-full bg-neutral-400 rounded-full"
                    style={{ width: `${Math.min((pct as number) * 3, 100)}%` }}
                  />
                </div>
                <span className="text-xs text-neutral-500 tabular-nums w-12 text-right">{(pct as number).toFixed(1)}%</span>
              </div>
            ))}
          </div>
        )}
        <ModuleStatus status={modules?.spectrum?.status} error={modules?.spectrum?.error} />

        {resonances && resonances.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs text-neutral-600">Detected resonances ({resonances.length})</p>
            {resonances.slice(0, 5).map((r, i) => (
              <div key={i} className="text-xs text-neutral-400 tabular-nums">
                {formatHz(r.center_frequency_hz)} — bandwidth {formatHz(r.bandwidth_hz)}, strength {r.strength}x
              </div>
            ))}
          </div>
        )}
        <ModuleStatus status={modules?.resonance?.status} error={modules?.resonance?.error} />

        {harshRegions && harshRegions.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs text-neutral-600">Harshness regions ({harshRegions.length})</p>
            {harshRegions.slice(0, 5).map((r, i) => (
              <button
                key={i}
                onClick={() => onSeek(r.start)}
                className="block text-xs text-rose-400 hover:text-rose-300 tabular-nums"
              >
                {formatTimeRange(r.start, r.end)}
              </button>
            ))}
          </div>
        )}
        {sibilanceRegions && sibilanceRegions.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs text-neutral-600">Sibilance regions ({sibilanceRegions.length})</p>
            {sibilanceRegions.slice(0, 5).map((r, i) => (
              <button
                key={i}
                onClick={() => onSeek(r.start)}
                className="block text-xs text-pink-400 hover:text-pink-300 tabular-nums"
              >
                {formatTimeRange(r.start, r.end)}
              </button>
            ))}
          </div>
        )}
        <ModuleStatus status={modules?.harshness_sibilance?.status} error={modules?.harshness_sibilance?.error} />
      </Section>

      {/* DYNAMICS Section */}
      <Section title="Dynamics" icon={Gauge}>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
          <Metric label="Crest Factor" value={analysis.crest_factor != null ? analysis.crest_factor.toFixed(2) : null} unit="dB" />
          <Metric label="Dynamic Range" value={analysis.dynamic_range != null ? analysis.dynamic_range.toFixed(2) : null} unit="dB" />
          <Metric label="Quiet-to-Loud" value={dynamicsData?.quiet_to_loud_variation_db as number ?? null} unit="dB" />
          <Metric label="Sample Peak" value={analysis.sample_peak != null ? analysis.sample_peak.toFixed(2) : null} unit="dBFS" />
          <Metric label="True Peak" value={analysis.true_peak != null ? analysis.true_peak.toFixed(2) : null} unit="dBTP" />
        </dl>
        <ModuleStatus status={modules?.dynamics?.status} error={modules?.dynamics?.error} />
      </Section>

      {/* TECHNICAL Section */}
      <Section title="Technical" icon={BarChart3} defaultOpen={false}>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
          <Metric label="DC Offset" value={analysis.dc_offset != null ? analysis.dc_offset.toExponential(2) : null} />
          <Metric label="DC Offset (dB)" value={dcData?.dc_offset_db as number ?? null} unit="dB" />
          <Metric label="Speech Detected" value={analysis.speech_percentage != null ? analysis.speech_percentage.toFixed(1) : null} unit="%" />
        </dl>

        {phaseData && (
          <div className="space-y-1">
            <p className="text-xs text-neutral-600">Channel Analysis</p>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
              <Metric label="L RMS" value={(phaseData.left_rms_dbfs as number)?.toFixed(2) ?? null} unit="dBFS" />
              <Metric label="R RMS" value={(phaseData.right_rms_dbfs as number)?.toFixed(2) ?? null} unit="dBFS" />
              <Metric label="Balance" value={(phaseData.balance_db as number)?.toFixed(2) ?? null} unit="dB" />
              <Metric label="Phase Corr." value={(phaseData.phase_correlation as number)?.toFixed(3) ?? null} />
            </dl>
            {phaseData.polarity_inverted as boolean && (
              <p className="text-xs text-red-400">Polarity inversion detected between channels</p>
            )}
            {phaseData.imbalance_significant as boolean && (
              <p className="text-xs text-amber-400">Significant channel imbalance detected</p>
            )}
          </div>
        )}
        <ModuleStatus status={modules?.phase?.status} error={modules?.phase?.error} />
        <ModuleStatus status={modules?.dc_offset?.status} error={modules?.dc_offset?.error} />

        {(fileInfoData?.format_flag as string | undefined) && (
          <div className="text-xs text-amber-400">{fileInfoData!.format_flag as string}</div>
        )}

        {/* Silence regions */}
        {silenceRegions && silenceRegions.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs text-neutral-600">Silence regions ({silenceRegions.length})</p>
            {silenceRegions.slice(0, 10).map((r, i) => (
              <div key={i} className="text-xs text-neutral-500 tabular-nums">
                {formatTimeRange(r.start, r.end)}
              </div>
            ))}
          </div>
        )}
        {nearSilenceRegions && nearSilenceRegions.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs text-neutral-600">Near-silence / room tone ({nearSilenceRegions.length})</p>
            {nearSilenceRegions.slice(0, 10).map((r, i) => (
              <div key={i} className="text-xs text-neutral-500 tabular-nums">
                {formatTimeRange(r.start, r.end)}
              </div>
            ))}
          </div>
        )}
        <ModuleStatus status={modules?.silence?.status} error={modules?.silence?.error} />

        {/* Speech regions */}
        {speechRegions && speechRegions.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs text-neutral-600">
              Speech regions ({speechRegions.length},
              {' '}{formatDuration(speechRegions.reduce((sum, r) => sum + (r.end - r.start), 0))} total)
            </p>
            {speechRegions.slice(0, 10).map((r, i) => (
              <div key={i} className="text-xs text-neutral-500 tabular-nums">
                {formatTimeRange(r.start, r.end)}
              </div>
            ))}
          </div>
        )}
        <ModuleStatus status={modules?.speech?.status} error={modules?.speech?.error} />
      </Section>

      {/* DETECTED ISSUES Section */}
      <Section title={`Detected Issues (${issues.length})`} icon={AlertTriangle}>
        {issues.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-green-400">
            <CheckCircle2 size={16} />
            <span>No issues detected</span>
          </div>
        ) : (
          <div className="space-y-1.5">
            {sortedIssues.map((issue) => {
              const isSelected = selectedIssue === issue.id;
              const color = issueTypeColors[issue.issue_type] ?? '#6b7280';
              return (
                <div
                  key={issue.id}
                  className={`rounded-md border px-3 py-2 cursor-pointer transition-colors ${
                    isSelected ? 'border-neutral-600 bg-neutral-800/60' : 'border-neutral-800 hover:bg-neutral-800/30'
                  }`}
                  onClick={() => {
                    setSelectedIssue(isSelected ? null : issue.id);
                    if (issue.start_time != null) onSeek(issue.start_time);
                  }}
                >
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                    <span className="text-sm text-neutral-200">{issueTypeLabels[issue.issue_type] ?? issue.issue_type}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${severityColors[issue.severity] ?? severityColors.info}`}>
                      {severityLabels[issue.severity] ?? issue.severity}
                    </span>
                    {issue.start_time != null && (
                      <span className="ml-auto text-xs text-neutral-500 tabular-nums">{formatTimecode(issue.start_time)}</span>
                    )}
                  </div>
                  <p className="text-xs text-neutral-500 mt-1">{issue.description}</p>
                  {issue.confidence != null && (
                    <p className="text-[10px] text-neutral-600 mt-0.5">Confidence: {(issue.confidence * 100).toFixed(0)}%</p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Section>
    </div>
  );
}
