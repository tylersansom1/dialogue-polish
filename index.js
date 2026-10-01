import { createClient } from '@supabase/supabase-js';

// --- Configuration ---
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const STORAGE_BUCKET = 'audio-files';
const POLL_INTERVAL_MS = 5000;
const PROCESSING_VERSION = 'phase1-ffmpeg';

// --- FFmpeg processing parameters (Phase 1 verification settings) ---
// These are intentionally simple to verify the processing infrastructure.
// They are NOT the eventual professional dialogue algorithm.
const HIGHPASS_FREQ_HZ = 70;
const COMPRESSOR_THRESHOLD_DB = -10;
const COMPRESSOR_RATIO = 2.5;
const COMPRESSOR_ATTACK_MS = 10;
const COMPRESSOR_RELEASE_MS = 150;
const LIMITER_CEILING_DB = -1.0;

const ANALYSIS_VERSION = 'analysis-2.0.0';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('[worker] FATAL: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables are required.');
  console.error('[worker] Set them in your environment or .env file.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// --- Utility functions ---
function log(jobId, message) {
  console.log(`[worker] job=${jobId} ${message}`);
}

async function downloadFile(storagePath, localPath) {
  const { data, error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .download(storagePath);
  if (error) throw new Error(`Download failed: ${error.message}`);

  const buffer = Buffer.from(await data.arrayBuffer());
  const fs = await import('node:fs/promises');
  await fs.writeFile(localPath, buffer);
  return buffer.length;
}

async function uploadFile(localPath, storagePath) {
  const fs = await import('node:fs/promises');
  const buffer = await fs.readFile(localPath);
  const { error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, buffer, { contentType: 'audio/wav', upsert: false });
  if (error) throw new Error(`Upload failed: ${error.message}`);
  return buffer.length;
}

// --- FFmpeg execution ---
async function runFFmpeg(args) {
  const { execFile } = await import('node:child_process');
  return new Promise((resolve, reject) => {
    console.log(`[worker] ffmpeg ${args.join(' ')}`);
    execFile('ffmpeg', args, { maxBuffer: 50 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        console.error(`[worker] ffmpeg error: ${stderr}`);
        reject(new Error(`FFmpeg failed: ${error.message}\n${stderr}`));
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

async function getAudioDuration(filePath) {
  const { execFile } = await import('node:child_process');
  return new Promise((resolve, reject) => {
    execFile('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      filePath,
    ], (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`ffprobe failed: ${error.message}`));
      } else {
        resolve(parseFloat(stdout.trim()));
      }
    });
  });
}

// --- Waveform peak extraction ---
async function extractWaveformPeaks(filePath, targetBuckets = 2000) {
  // Use ffprobe to get raw PCM samples, then compute peaks
  const { execFile } = await import('node:child_process');
  const fs = await import('node:fs/promises');
  const tmpRaw = `/tmp/peaks_${Date.now()}.raw`;

  return new Promise((resolve, reject) => {
    // Export as raw 16-bit PCM mono for peak analysis
    execFile('ffmpeg', [
      '-i', filePath,
      '-f', 's16le',
      '-acodec', 'pcm_s16le',
      '-ar', '8000',  // downsample for waveform — we only need peaks
      '-ac', '1',     // mono mix for waveform display
      '-y', tmpRaw,
    ], async (error) => {
      if (error) {
        reject(new Error(`Waveform extraction failed: ${error.message}`));
        return;
      }

      try {
        const rawBuffer = await fs.readFile(tmpRaw);
        const samples = new Int16Array(rawBuffer.buffer, rawBuffer.byteOffset, Math.floor(rawBuffer.length / 2));
        const samplesPerBucket = Math.floor(samples.length / targetBuckets);
        const peaks = [];

        for (let b = 0; b < targetBuckets; b++) {
          const start = b * samplesPerBucket;
          const end = Math.min(start + samplesPerBucket, samples.length);
          let min = 0, max = 0;
          for (let i = start; i < end; i++) {
            const s = samples[i] / 32768;
            if (s < min) min = s;
            if (s > max) max = s;
          }
          peaks.push({ min: Math.round(min * 10000) / 10000, max: Math.round(max * 10000) / 10000 });
        }

        await fs.unlink(tmpRaw).catch(() => {});
        resolve(peaks);
      } catch (err) {
        await fs.unlink(tmpRaw).catch(() => {});
        reject(err);
      }
    });
  });
}

// --- Core processing function ---
// This is the clean processing interface that can be swapped out later.
// Future versions can use Python DSP, Spotify Pedalboard, DeepFilterNet, ML models, etc.
async function processDialogue(inputPath, outputPath, sampleRate, channels, bitDepth) {
  // Build FFmpeg filter chain:
  // 1. High-pass filter at 70 Hz
  // 2. Gentle compression
  // 3. Peak limiter at safe ceiling
  // The output preserves the original sample rate, channels, and timeline duration.

  const filterChain = [
    `highpass=f=${HIGHPASS_FREQ_HZ}`,
    `acompressor=threshold=${COMPRESSOR_THRESHOLD_DB}dB:ratio=${COMPRESSOR_RATIO}:attack=${COMPRESSOR_ATTACK_MS}:release=${COMPRESSOR_RELEASE_MS}:makeup=1`,
    `alimiter=limit=${LIMITER_CEILING_DB}dB:attack=5:release=50`,
  ].join(',');

  const outputBitDepth = Math.max(24, bitDepth || 24);
  const codec = outputBitDepth === 24 ? 'pcm_s24le' : outputBitDepth === 32 ? 'pcm_s32le' : 'pcm_s16le';

  const args = [
    '-i', inputPath,
    '-af', filterChain,
    '-ar', String(sampleRate),
    '-ac', String(channels),
    '-c:a', codec,
    '-y', outputPath,
  ];

  await runFFmpeg(args);
}

// --- Analysis job processing ---
async function analyzeJob(job) {
  const { data: sourceFile, error: sourceError } = await supabase
    .from('audio_files')
    .select('*')
    .eq('id', job.source_audio_file_id)
    .maybeSingle();

  if (sourceError || !sourceFile) {
    throw new Error(`Source file not found: ${job.source_audio_file_id}`);
  }

  log(job.id, `Analyzing: ${sourceFile.original_filename} (${sourceFile.storage_path})`);

  await supabase
    .from('processing_jobs')
    .update({ status: 'processing', progress: 5, started_at: new Date().toISOString() })
    .eq('id', job.id);

  const fs = await import('node:fs/promises');
  const tmpDir = `/tmp/analysis_${job.id}`;
  await fs.mkdir(tmpDir, { recursive: true });

  const inputPath = `${tmpDir}/input.wav`;
  const outputJsonPath = `${tmpDir}/analysis_results.json`;

  try {
    // Download source file
    await supabase.from('processing_jobs').update({ progress: 10 }).eq('id', job.id);
    log(job.id, 'Downloading source file for analysis…');
    const downloadedBytes = await downloadFile(sourceFile.storage_path, inputPath);
    log(job.id, `Downloaded ${downloadedBytes} bytes`);

    // Create initial analysis record
    const { data: analysisRecord, error: analysisError } = await supabase
      .from('dialogue_analyses')
      .insert({
        audio_file_id: sourceFile.id,
        user_id: sourceFile.user_id,
        analysis_version: ANALYSIS_VERSION,
        status: 'running',
      })
      .select('id')
      .maybeSingle();

    if (analysisError || !analysisRecord) {
      throw new Error(`Failed to create analysis record: ${analysisError?.message}`);
    }

    const analysisId = analysisRecord.id;
    log(job.id, `Created dialogue_analyses record: ${analysisId}`);

    // Run Python analysis script
    await supabase.from('processing_jobs').update({ progress: 20 }).eq('id', job.id);
    log(job.id, 'Running Python analysis engine…');

    const { execFile } = await import('node:child_process');
    await new Promise((resolve, reject) => {
      execFile('python3', ['analyze.py', inputPath, outputJsonPath], {
        maxBuffer: 100 * 1024 * 1024,
        timeout: 600000,
      }, (error, stdout, stderr) => {
        if (error) {
          console.error(`[worker] Python analysis error: ${stderr}`);
          reject(new Error(`Analysis script failed: ${error.message}\n${stderr}`));
        } else {
          stdout.split('\n').forEach((line) => {
            if (line.trim()) log(job.id, `  ${line}`);
          });
          resolve();
        }
      });
    });

    await supabase.from('processing_jobs').update({ progress: 70 }).eq('id', job.id);

    // Read and parse the analysis JSON
    log(job.id, 'Reading analysis results…');
    const jsonBuffer = await fs.readFile(outputJsonPath);
    const analysisOutput = JSON.parse(jsonBuffer.toString());

    if (analysisOutput.status === 'failed') {
      throw new Error(`Analysis engine failed: ${analysisOutput.error}`);
    }

    const s = analysisOutput.structured || {};

    // Update the analysis record with structured values
    log(job.id, 'Storing analysis results in database…');
    const { error: updateError } = await supabase
      .from('dialogue_analyses')
      .update({
        status: 'completed',
        integrated_lufs: s.integrated_lufs,
        loudness_range: s.loudness_range,
        true_peak: s.true_peak,
        sample_peak: s.sample_peak,
        maximum_momentary_loudness: s.maximum_momentary_loudness,
        maximum_short_term_loudness: s.maximum_short_term_loudness,
        rms_average: s.rms_average,
        estimated_noise_floor: s.estimated_noise_floor,
        dynamic_range: s.dynamic_range,
        crest_factor: s.crest_factor,
        dc_offset: s.dc_offset,
        clipping_count: s.clipping_count,
        speech_percentage: s.speech_percentage,
        analysis_data_json: analysisOutput.modules || {},
        summary_text: analysisOutput.summary_text,
        completed_at: new Date().toISOString(),
      })
      .eq('id', analysisId);

    if (updateError) {
      log(job.id, `Warning: failed to update analysis record: ${updateError.message}`);
    }

    // Insert issues
    const issues = analysisOutput.issues || [];
    if (issues.length > 0) {
      log(job.id, `Storing ${issues.length} detected issues…`);
      const issuesToInsert = issues.map((issue) => ({
        analysis_id: analysisId,
        user_id: sourceFile.user_id,
        issue_type: issue.issue_type,
        severity: issue.severity,
        start_time: issue.start_time,
        end_time: issue.end_time,
        center_frequency: issue.center_frequency,
        measured_value: issue.measured_value,
        threshold_value: issue.threshold_value,
        description: issue.description,
        confidence: issue.confidence,
      }));

      const { error: issuesError } = await supabase
        .from('dialogue_analysis_issues')
        .insert(issuesToInsert);

      if (issuesError) {
        log(job.id, `Warning: failed to insert some issues: ${issuesError.message}`);
      }
    }

    // Update job to completed
    await supabase
      .from('processing_jobs')
      .update({
        status: 'completed',
        progress: 100,
        completed_at: new Date().toISOString(),
      })
      .eq('id', job.id);

    log(job.id, `Analysis completed. ${issues.length} issues detected.`);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

// --- Job processing ---
async function processJob(job) {
  const { data: sourceFile, error: sourceError } = await supabase
    .from('audio_files')
    .select('*')
    .eq('id', job.source_audio_file_id)
    .maybeSingle();

  if (sourceError || !sourceFile) {
    throw new Error(`Source file not found: ${job.source_audio_file_id}`);
  }

  log(job.id, `Processing: ${sourceFile.original_filename} (${sourceFile.storage_path})`);

  // Update job to processing
  await supabase
    .from('processing_jobs')
    .update({ status: 'processing', progress: 5, started_at: new Date().toISOString(), processing_version: PROCESSING_VERSION })
    .eq('id', job.id);

  const fs = await import('node:fs/promises');
  const tmpDir = `/tmp/job_${job.id}`;
  await fs.mkdir(tmpDir, { recursive: true });

  const inputPath = `${tmpDir}/input.wav`;
  const outputPath = `${tmpDir}/output.wav`;

  try {
    // Download original
    await supabase.from('processing_jobs').update({ progress: 10 }).eq('id', job.id);
    log(job.id, 'Downloading source file…');
    const downloadedBytes = await downloadFile(sourceFile.storage_path, inputPath);
    log(job.id, `Downloaded ${downloadedBytes} bytes`);

    // Get input duration for verification
    const inputDuration = await getAudioDuration(inputPath);
    log(job.id, `Input duration: ${inputDuration}s`);

    await supabase.from('processing_jobs').update({ progress: 25 }).eq('id', job.id);

    // Extract original waveform if not present
    if (!sourceFile.waveform_data) {
      log(job.id, 'Extracting original waveform peaks…');
      const originalPeaks = await extractWaveformPeaks(inputPath);
      await supabase
        .from('audio_files')
        .update({ waveform_data: originalPeaks })
        .eq('id', sourceFile.id);
    }

    await supabase.from('processing_jobs').update({ progress: 40 }).eq('id', job.id);

    // Process
    log(job.id, 'Starting FFmpeg processing…');
    await processDialogue(
      inputPath,
      outputPath,
      sourceFile.sample_rate || 48000,
      sourceFile.channels || 1,
      sourceFile.bit_depth || 24,
    );

    await supabase.from('processing_jobs').update({ progress: 70 }).eq('id', job.id);

    // Verify output duration matches input
    const outputDuration = await getAudioDuration(outputPath);
    log(job.id, `Output duration: ${outputDuration}s`);

    const durationDiff = Math.abs(outputDuration - inputDuration);
    if (durationDiff > 0.05) {
      throw new Error(
        `Duration mismatch: input=${inputDuration}s, output=${outputDuration}s (diff=${durationDiff}s). ` +
        `The processed file must maintain exactly the same timeline duration as the source for film sync.`
      );
    }
    log(job.id, 'Duration verification passed');

    await supabase.from('processing_jobs').update({ progress: 85 }).eq('id', job.id);

    // Extract processed waveform
    log(job.id, 'Extracting processed waveform peaks…');
    const processedPeaks = await extractWaveformPeaks(outputPath);

    // Upload processed file
    const processedFilename = `processed_${Date.now()}.wav`;
    const outputPath_storage = `${sourceFile.user_id}/${job.project_id}/${processedFilename}`;
    log(job.id, `Uploading processed file to: ${outputPath_storage}`);
    const outputSize = await uploadFile(outputPath, outputPath_storage);

    await supabase.from('processing_jobs').update({ progress: 90 }).eq('id', job.id);

    // Create audio_files record for processed output
    const { data: processedAudioFile, error: insertError } = await supabase
      .from('audio_files')
      .insert({
        project_id: job.project_id,
        user_id: sourceFile.user_id,
        original_filename: `processed_${sourceFile.original_filename}`,
        storage_path: outputPath_storage,
        type: 'processed',
        duration_seconds: Math.round(outputDuration * 1000) / 1000,
        sample_rate: sourceFile.sample_rate,
        bit_depth: Math.max(24, sourceFile.bit_depth || 24),
        channels: sourceFile.channels,
        file_size: outputSize,
        waveform_data: processedPeaks,
      })
      .select('id')
      .maybeSingle();

    if (insertError || !processedAudioFile) {
      throw new Error(`Failed to create processed audio file record: ${insertError?.message}`);
    }

    log(job.id, `Created processed audio_files record: ${processedAudioFile.id}`);

    // Update job to completed
    await supabase
      .from('processing_jobs')
      .update({
        status: 'completed',
        progress: 100,
        output_audio_file_id: processedAudioFile.id,
        completed_at: new Date().toISOString(),
      })
      .eq('id', job.id);

    log(job.id, 'Job completed successfully');
  } finally {
    // Cleanup temp files
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

// --- Main polling loop ---
async function pollForJobs() {
  while (true) {
    try {
      // Atomically claim a queued job by updating its status
      // This uses a filter + update pattern; for production with multiple workers,
      // consider using a Postgres advisory lock or SELECT FOR UPDATE.
      const { data: queuedJobs, error: queryError } = await supabase
        .from('processing_jobs')
        .select('id, project_id, source_audio_file_id, status, processing_version')
        .eq('status', 'queued')
        .order('created_at', { ascending: true })
        .limit(1);

      if (queryError) {
        console.error('[worker] Error querying for jobs:', queryError.message);
      } else if (queuedJobs && queuedJobs.length > 0) {
        const job = queuedJobs[0];

        // Try to claim it by setting status to processing
        const { data: claimed, error: claimError } = await supabase
          .from('processing_jobs')
          .update({ status: 'processing', started_at: new Date().toISOString() })
          .eq('id', job.id)
          .eq('status', 'queued') // optimistic — only claim if still queued
          .select()
          .maybeSingle();

        if (claimError) {
          console.error('[worker] Error claiming job:', claimError.message);
        } else if (claimed) {
          console.log(`[worker] Claimed job ${claimed.id} (version: ${claimed.processing_version})`);
          try {
            if (claimed.processing_version && claimed.processing_version.startsWith('analysis')) {
              await analyzeJob(claimed);
            } else {
              await processJob(claimed);
            }
          } catch (err) {
            console.error(`[worker] Job ${claimed.id} failed:`, err.message);
            await supabase
              .from('processing_jobs')
              .update({
                status: 'failed',
                error_message: err.message || 'Unknown error',
                completed_at: new Date().toISOString(),
              })
              .eq('id', claimed.id);
          }
          continue; // Immediately check for more jobs
        }
      }
    } catch (err) {
      console.error('[worker] Unexpected error in poll loop:', err.message);
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

// --- Start ---
console.log(`[worker] Dialogue Polish audio worker starting…`);
console.log(`[worker] Supabase URL: ${SUPABASE_URL}`);
console.log(`[worker] Poll interval: ${POLL_INTERVAL_MS}ms`);
console.log(`[worker] Processing version: ${PROCESSING_VERSION}`);
console.log(`[worker] Analysis version: ${ANALYSIS_VERSION}`);
console.log(`[worker] FFmpeg filter: highpass=${HIGHPASS_FREQ_HZ}Hz, compressor=${COMPRESSOR_THRESHOLD_DB}dB/${COMPRESSOR_RATIO}:1, limiter=${LIMITER_CEILING_DB}dB`);

// Verify FFmpeg and Python are available
import('node:child_process').then(({ execFile }) => {
  execFile('ffmpeg', ['-version'], (error, stdout) => {
    if (error) {
      console.error('[worker] FATAL: FFmpeg not found. Install it with: apt-get install ffmpeg (Linux) or brew install ffmpeg (macOS)');
      process.exit(1);
    }
    const version = stdout.split('\n')[0];
    console.log(`[worker] FFmpeg: ${version}`);

    execFile('python3', ['--version'], (pyError, pyStdout, pyStderr) => {
      if (pyError) {
        console.error('[worker] WARNING: Python3 not found. Analysis jobs will fail.');
        console.error('[worker] Install Python3 and run: pip3 install -r requirements.txt');
      } else {
        console.log(`[worker] Python: ${(pyStdout || pyStderr || '').trim()}`);
      }
      console.log('[worker] Ready. Waiting for jobs…');
      pollForJobs();
    });
  });
});
