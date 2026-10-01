import { useEffect, useRef, useState, useCallback } from 'react';
import { Play, Pause, Loader2, AlertCircle } from 'lucide-react';
import Waveform from './Waveform';
import type { WaveformPeak } from '@/types/database';
import { formatDuration } from '@/lib/format';

interface AudioPlayerProps {
  src: string | null;
  peaks: WaveformPeak[] | null;
  label: string;
  disabled?: boolean;
  seekTo?: number | null;
  onSeekComplete?: () => void;
}

export default function AudioPlayer({ src, peaks, label, disabled, seekTo, onSeekComplete }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Reload audio when src changes (signed URL may update after upload)
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    setLoadError(null);
    setLoading(false);
    setCurrentTime(0);
    setDuration(0);
    if (src) {
      setLoading(true);
      audio.load();
    }
  }, [src]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTimeUpdate = () => setCurrentTime(audio.currentTime);
    const onLoadedMetadata = () => {
      setDuration(audio.duration);
      setLoading(false);
      setLoadError(null);
    };
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onWaiting = () => setLoading(true);
    const onCanPlay = () => { setLoading(false); setLoadError(null); };
    const onError = () => {
      setLoading(false);
      setLoadError('Unable to load audio. The file may be corrupted or the link may have expired.');
    };

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('loadedmetadata', onLoadedMetadata);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('waiting', onWaiting);
    audio.addEventListener('canplay', onCanPlay);
    audio.addEventListener('error', onError);

    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('waiting', onWaiting);
      audio.removeEventListener('canplay', onCanPlay);
      audio.removeEventListener('error', onError);
    };
  }, []);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !src || loadError) return;
    if (isPlaying) {
      audio.pause();
    } else {
      audio.play().catch(() => {
        setLoadError('Playback failed. Try clicking play again.');
      });
    }
  }, [isPlaying, src, loadError]);

  const handleSeek = useCallback((ratio: number) => {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    audio.currentTime = ratio * duration;
    setCurrentTime(ratio * duration);
  }, [duration]);

  // External seek support (from analysis timeline clicks)
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || seekTo == null) return;
    audio.currentTime = seekTo;
    setCurrentTime(seekTo);
    onSeekComplete?.();
  }, [seekTo, onSeekComplete]);

  const progress = duration > 0 ? currentTime / duration : 0;
  const canPlay = src && !loadError && !loading;

  return (
    <div className={`rounded-lg border border-neutral-800 bg-neutral-900/50 p-4 ${disabled ? 'opacity-40' : ''}`}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-medium uppercase tracking-wider text-neutral-500">{label}</span>
        <span className="text-xs tabular-nums text-neutral-500">
          {formatDuration(currentTime)} / {formatDuration(duration)}
        </span>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={togglePlay}
          disabled={!canPlay || disabled}
          className="flex-shrink-0 flex items-center justify-center w-10 h-10 rounded-full bg-neutral-100 text-neutral-900 hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          aria-label={isPlaying ? 'Pause' : 'Play'}
        >
          {loading ? (
            <Loader2 size={18} className="animate-spin" />
          ) : isPlaying ? (
            <Pause size={18} />
          ) : (
            <Play size={18} className="ml-0.5" />
          )}
        </button>

        <div className="flex-1 min-w-0">
          <Waveform
            peaks={peaks}
            progress={progress}
            onSeek={handleSeek}
            height={64}
          />
        </div>
      </div>

      {loadError && (
        <div className="mt-3 flex items-center gap-2 text-xs text-amber-400">
          <AlertCircle size={14} />
          <span>{loadError}</span>
        </div>
      )}

      {loading && !loadError && (
        <p className="mt-2 text-xs text-neutral-600">Loading audio…</p>
      )}

      {src && (
        <audio ref={audioRef} src={src} preload="metadata" crossOrigin="anonymous" />
      )}
    </div>
  );
}
