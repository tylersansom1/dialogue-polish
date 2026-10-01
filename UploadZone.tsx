import { useState, useRef, useCallback, type DragEvent } from 'react';
import { Upload, FileAudio } from 'lucide-react';

interface UploadZoneProps {
  onFileSelected: (file: File) => void;
  disabled?: boolean;
  uploading?: boolean;
  uploadProgress?: number;
}

export default function UploadZone({ onFileSelected, disabled, uploading, uploadProgress }: UploadZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled) setIsDragging(true);
  }, [disabled]);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (disabled || uploading) return;

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const file = files[0];
      if (file.name.toLowerCase().endsWith('.wav')) {
        onFileSelected(file);
      }
    }
  }, [disabled, uploading, onFileSelected]);

  const handleClick = () => {
    if (!disabled && !uploading) inputRef.current?.click();
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onFileSelected(file);
    e.target.value = '';
  };

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={handleClick}
      className={`
        relative rounded-lg border-2 border-dashed p-8 text-center cursor-pointer transition-colors
        ${isDragging ? 'border-neutral-500 bg-neutral-900/60' : 'border-neutral-800 bg-neutral-900/30 hover:border-neutral-700'}
        ${disabled || uploading ? 'cursor-wait opacity-60' : ''}
      `}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".wav,audio/wav,audio/x-wav,audio/wave"
        onChange={handleChange}
        disabled={disabled || uploading}
        className="hidden"
      />

      {uploading ? (
        <div className="space-y-3">
          <div className="flex items-center justify-center">
            <FileAudio size={32} className="text-neutral-500 animate-pulse" />
          </div>
          <p className="text-sm text-neutral-400">Uploading…</p>
          {uploadProgress != null && (
            <div className="max-w-xs mx-auto">
              <div className="h-1 rounded-full bg-neutral-800 overflow-hidden">
                <div
                  className="h-full bg-neutral-400 transition-all duration-300"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
              <p className="mt-1 text-xs tabular-nums text-neutral-600">{uploadProgress}%</p>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-center">
            <Upload size={32} className="text-neutral-500" />
          </div>
          <p className="text-sm text-neutral-400">
            Drop a WAV file here or click to browse
          </p>
          <p className="text-xs text-neutral-600">
            Mono or stereo · 48 kHz / 24-bit preferred
          </p>
        </div>
      )}
    </div>
  );
}
