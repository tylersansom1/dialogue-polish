import { FileAudio, Clock, Music2, Hash, Waves, HardDrive } from 'lucide-react';
import type { AudioFile } from '@/types/database';
import { formatDuration, formatFileSize, formatSampleRate, formatBitDepth, formatChannels } from '@/lib/format';

interface FileMetadataProps {
  file: AudioFile | null;
}

export default function FileMetadata({ file }: FileMetadataProps) {
  if (!file) return null;

  const items = [
    { icon: FileAudio, label: 'Filename', value: file.original_filename },
    { icon: Clock, label: 'Duration', value: formatDuration(file.duration_seconds) },
    { icon: Music2, label: 'Sample Rate', value: formatSampleRate(file.sample_rate) },
    { icon: Hash, label: 'Bit Depth', value: formatBitDepth(file.bit_depth) },
    { icon: Waves, label: 'Channels', value: formatChannels(file.channels) },
    { icon: HardDrive, label: 'File Size', value: formatFileSize(file.file_size) },
  ];

  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-4">
      <h3 className="text-xs font-medium uppercase tracking-wider text-neutral-500 mb-3">File Information</h3>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
        {items.map(({ icon: Icon, label, value }) => (
          <div key={label}>
            <dt className="flex items-center gap-1.5 text-xs text-neutral-600 mb-0.5">
              <Icon size={12} />
              {label}
            </dt>
            <dd className="text-sm text-neutral-300 truncate" title={value}>
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
