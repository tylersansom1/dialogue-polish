import { useEffect, useRef, useCallback } from 'react';
import type { WaveformPeak } from '@/types/database';

interface WaveformProps {
  peaks: WaveformPeak[] | null;
  progress: number; // 0-1
  onSeek?: (ratio: number) => void;
  color?: string;
  progressColor?: string;
  height?: number;
}

export default function Waveform({
  peaks,
  progress,
  onSeek,
  color = '#525252',
  progressColor = '#d4d4d4',
  height = 80,
}: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const displayWidth = container.clientWidth;
    const displayHeight = height;

    canvas.width = displayWidth * dpr;
    canvas.height = displayHeight * dpr;
    canvas.style.width = `${displayWidth}px`;
    canvas.style.height = `${displayHeight}px`;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, displayWidth, displayHeight);

    if (!peaks || peaks.length === 0) {
      // Draw flat line
      ctx.fillStyle = color;
      const centerY = displayHeight / 2;
      ctx.fillRect(0, centerY - 0.5, displayWidth, 1);
      return;
    }

    const midY = displayHeight / 2;
    const barWidth = displayWidth / peaks.length;
    const progressX = displayWidth * progress;

    for (let i = 0; i < peaks.length; i++) {
      const x = i * barWidth;
      const peak = peaks[i];
      const amplitude = Math.max(Math.abs(peak.min), Math.abs(peak.max));
      const barHeight = Math.max(1, amplitude * (displayHeight * 0.45));

      ctx.fillStyle = x < progressX ? progressColor : color;
      ctx.fillRect(x, midY - barHeight, Math.max(1, barWidth - 0.5), barHeight * 2);
    }
  }, [peaks, progress, color, progressColor, height]);

  useEffect(() => {
    draw();
    const handleResize = () => draw();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [draw]);

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!onSeek) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    onSeek(Math.max(0, Math.min(1, ratio)));
  };

  return (
    <div
      ref={containerRef}
      onClick={handleClick}
      className="w-full relative cursor-pointer"
      style={{ height: `${height}px` }}
    >
      <canvas ref={canvasRef} className="absolute inset-0" />
    </div>
  );
}
