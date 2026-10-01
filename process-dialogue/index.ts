import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

// --- DSP Parameters (Phase 1 verification settings) ---
const HIGHPASS_FREQ_HZ = 70;
const COMPRESSOR_THRESHOLD = 0.35; // ~-10 dBFS in linear
const COMPRESSOR_RATIO = 2.5;
const COMPRESSOR_ATTACK_MS = 10;
const COMPRESSOR_RELEASE_MS = 150;
const LIMITER_CEILING = 0.89; // ~-1 dBFS in linear
const LIMITER_LOOKAHEAD_SAMPLES = 64;

// Edge function memory/time safety: skip files larger than this
// 48kHz stereo 24-bit ~ 50MB = ~87 seconds of audio
const MAX_FILE_SIZE_BYTES = 60 * 1024 * 1024; // 60 MB

interface WavData {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  samples: Float32Array; // interleaved, normalized to [-1, 1]
  audioFormat: number;
}

function readUint32LE(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

function readUint16LE(view: DataView, offset: number): number {
  return view.getUint16(offset, true);
}

function parseWav(buffer: ArrayBuffer): WavData | null {
  const view = new DataView(buffer);

  if (view.byteLength < 44) return null;

  const riff = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (riff !== "RIFF") return null;

  const wave = String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11));
  if (wave !== "WAVE") return null;

  let offset = 12;
  let sampleRate = 0;
  let channels = 0;
  let bitsPerSample = 0;
  let audioFormat = 0;
  let dataOffset = 0;
  let dataSize = 0;

  while (offset + 8 <= view.byteLength) {
    const chunkId = String.fromCharCode(
      view.getUint8(offset),
      view.getUint8(offset + 1),
      view.getUint8(offset + 2),
      view.getUint8(offset + 3),
    );
    const chunkSize = readUint32LE(view, offset + 4);

    if (chunkId === "fmt ") {
      audioFormat = readUint16LE(view, offset + 8);
      channels = readUint16LE(view, offset + 10);
      sampleRate = readUint32LE(view, offset + 12);
      bitsPerSample = readUint16LE(view, offset + 22);
    } else if (chunkId === "data") {
      dataOffset = offset + 8;
      dataSize = chunkSize;
      break;
    }

    offset += 8 + chunkSize + (chunkSize % 2);
  }

  if (!dataOffset || !sampleRate || !channels || !bitsPerSample) return null;
  if (audioFormat !== 1 && audioFormat !== 0xFFFE) return null; // PCM or WAVE_FORMAT_EXTENSIBLE

  const bytesPerSample = bitsPerSample / 8;
  const totalSamples = Math.floor(dataSize / bytesPerSample);
  const samples = new Float32Array(totalSamples);

  for (let i = 0; i < totalSamples; i++) {
    const byteOffset = dataOffset + i * bytesPerSample;
    if (byteOffset + bytesPerSample > view.byteLength) break;

    let sample: number;
    if (bitsPerSample === 16) {
      sample = view.getInt16(byteOffset, true) / 32768;
    } else if (bitsPerSample === 24) {
      const b0 = view.getUint8(byteOffset);
      const b1 = view.getUint8(byteOffset + 1);
      const b2 = view.getUint8(byteOffset + 2);
      let val = (b2 << 16) | (b1 << 8) | b0;
      if (val & 0x800000) val |= 0xFF000000; // sign extend
      sample = val / 8388608;
    } else if (bitsPerSample === 32) {
      // Could be int32 or float32 — check subformat if EXTENSIBLE
      if (audioFormat === 0xFFFE) {
        // For EXTENSIBLE, check the subformat GUID (offset 24 in fmt data, first 2 bytes = PCM or IEEE_FLOAT)
        // IEEE_FLOAT subformat starts with 0x0003
        // We'll assume float for 32-bit EXTENSIBLE
        sample = view.getFloat32(byteOffset, true);
      } else {
        sample = view.getInt32(byteOffset, true) / 2147483648;
      }
    } else {
      return null;
    }

    samples[i] = sample;
  }

  return { sampleRate, channels, bitsPerSample, samples, audioFormat };
}

function writeWavHeader(
  view: DataView,
  sampleRate: number,
  channels: number,
  bitsPerSample: number,
  dataLength: number,
): void {
  const blockAlign = (channels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;

  // RIFF header
  view.setUint8(0, 0x52); // R
  view.setUint8(1, 0x49); // I
  view.setUint8(2, 0x46); // F
  view.setUint8(3, 0x46); // F
  view.setUint32(4, 36 + dataLength, true);
  view.setUint8(8, 0x57); // W
  view.setUint8(9, 0x41); // A
  view.setUint8(10, 0x56); // V
  view.setUint8(11, 0x45); // E

  // fmt chunk
  view.setUint8(12, 0x66); // f
  view.setUint8(13, 0x6d); // m
  view.setUint8(14, 0x74); // t
  view.setUint8(15, 0x20); // (space)
  view.setUint32(16, 16, true); // chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  // data chunk header
  view.setUint8(36, 0x64); // d
  view.setUint8(37, 0x61); // a
  view.setUint8(38, 0x74); // t
  view.setUint8(39, 0x61); // a
  view.setUint32(40, dataLength, true);
}

function encodeWav(wavData: WavData, outputBitsPerSample: number): ArrayBuffer {
  const totalSamples = wavData.samples.length;
  const bytesPerSample = outputBitsPerSample / 8;
  const dataSize = totalSamples * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeWavHeader(view, wavData.sampleRate, wavData.channels, outputBitsPerSample, dataSize);

  for (let i = 0; i < totalSamples; i++) {
    const byteOffset = 44 + i * bytesPerSample;
    // Clamp to [-1, 1]
    let sample = Math.max(-1, Math.min(1, wavData.samples[i]));

    if (outputBitsPerSample === 16) {
      view.setInt16(byteOffset, Math.round(sample * 32767), true);
    } else if (outputBitsPerSample === 24) {
      const val = Math.round(sample * 8388607);
      view.setUint8(byteOffset, val & 0xFF);
      view.setUint8(byteOffset + 1, (val >> 8) & 0xFF);
      view.setUint8(byteOffset + 2, (val >> 16) & 0xFF);
    } else if (outputBitsPerSample === 32) {
      view.setInt32(byteOffset, Math.round(sample * 2147483647), true);
    }
  }

  return buffer;
}

// --- DSP: Biquad high-pass filter (RBJ cookbook) ---
function applyHighPass(samples: Float32Array, sampleRate: number, freqHz: number): Float32Array {
  const w0 = (2 * Math.PI * freqHz) / sampleRate;
  const cosW0 = Math.cos(w0);
  const sinW0 = Math.sin(w0);
  const Q = 0.707;
  const alpha = sinW0 / (2 * Q);

  const b0 = (1 + cosW0) / 2;
  const b1 = -(1 + cosW0);
  const b2 = (1 + cosW0) / 2;
  const a0 = 1 + alpha;
  const a1 = -2 * cosW0;
  const a2 = 1 - alpha;

  // Normalize
  const nb0 = b0 / a0;
  const nb1 = b1 / a0;
  const nb2 = b2 / a0;
  const na1 = a1 / a0;
  const na2 = a2 / a0;

  const output = new Float32Array(samples.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;

  for (let i = 0; i < samples.length; i++) {
    const x0 = samples[i];
    const y0 = nb0 * x0 + nb1 * x1 + nb2 * x2 - na1 * y1 - na2 * y2;
    output[i] = y0;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
  }

  return output;
}

// --- DSP: Simple feed-forward compressor with envelope follower ---
function applyCompressor(
  samples: Float32Array,
  sampleRate: number,
  threshold: number,
  ratio: number,
  attackMs: number,
  releaseMs: number,
): Float32Array {
  const attackCoeff = Math.exp(-1 / (sampleRate * (attackMs / 1000)));
  const releaseCoeff = Math.exp(-1 / (sampleRate * (releaseMs / 1000)));

  const output = new Float32Array(samples.length);
  let envelope = 0;

  for (let i = 0; i < samples.length; i++) {
    const input = Math.abs(samples[i]);

    // Envelope follower (attack / release)
    if (input > envelope) {
      envelope = attackCoeff * envelope + (1 - attackCoeff) * input;
    } else {
      envelope = releaseCoeff * envelope + (1 - releaseCoeff) * input;
    }

    // Gain computation (feed-forward, upward compression)
    let gain = 1;
    if (envelope > threshold) {
      const compressedLevel = threshold + (envelope - threshold) / ratio;
      gain = compressedLevel / envelope;
    }

    output[i] = samples[i] * gain;
  }

  return output;
}

// --- DSP: Lookahead peak limiter ---
function applyLimiter(
  samples: Float32Array,
  ceiling: number,
  lookahead: number,
): Float32Array {
  const output = new Float32Array(samples.length);

  // Find peak over lookahead window and apply gain
  for (let i = 0; i < samples.length; i++) {
    let peak = 0;
    const windowEnd = Math.min(i + lookahead, samples.length);
    for (let j = i; j < windowEnd; j++) {
      const abs = Math.abs(samples[j]);
      if (abs > peak) peak = abs;
    }

    let gain = 1;
    if (peak > ceiling) {
      gain = ceiling / peak;
    }

    output[i] = samples[i] * gain;
  }

  // Final safety clip
  for (let i = 0; i < output.length; i++) {
    if (output[i] > ceiling) output[i] = ceiling;
    if (output[i] < -ceiling) output[i] = -ceiling;
  }

  return output;
}

// --- Waveform peak extraction ---
function extractWaveformPeaks(samples: Float32Array, channels: number, targetBuckets: number): { min: number; max: number }[] {
  const samplesPerBucket = Math.floor(samples.length / targetBuckets);
  if (samplesPerBucket === 0) return [{ min: 0, max: 0 }];

  const peaks: { min: number; max: number }[] = [];
  for (let b = 0; b < targetBuckets; b++) {
    const start = b * samplesPerBucket;
    const end = Math.min(start + samplesPerBucket, samples.length);
    let min = 0;
    let max = 0;
    for (let i = start; i < end; i += channels) {
      const sample = samples[i];
      if (sample < min) min = sample;
      if (sample > max) max = sample;
    }
    peaks.push({ min, max });
  }
  return peaks;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  let jobId: string | null = null;

  try {
    const { jobId: jid } = await req.json();
    jobId = jid;

    if (!jobId) {
      return new Response(JSON.stringify({ error: "jobId is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Fetch the job
    const { data: job, error: jobError } = await supabase
      .from("processing_jobs")
      .select("id, project_id, source_audio_file_id, status")
      .eq("id", jobId)
      .maybeSingle();

    if (jobError || !job) {
      console.error("[process-dialogue] Job not found:", jobId, jobError);
      return new Response(JSON.stringify({ error: "Job not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Update job to processing
    await supabase
      .from("processing_jobs")
      .update({ status: "processing", progress: 5, started_at: new Date().toISOString() })
      .eq("id", jobId);

    // Fetch source audio file
    const { data: sourceFile, error: sourceError } = await supabase
      .from("audio_files")
      .select("id, storage_path, original_filename, file_size, sample_rate, bit_depth, channels")
      .eq("id", job.source_audio_file_id)
      .maybeSingle();

    if (sourceError || !sourceFile) {
      throw new Error(`Source audio file not found: ${job.source_audio_file_id}`);
    }

    console.log(`[process-dialogue] Processing: ${sourceFile.original_filename} (${sourceFile.file_size} bytes)`);

    // Check file size — edge function cannot handle very large files
    if (sourceFile.file_size && sourceFile.file_size > MAX_FILE_SIZE_BYTES) {
      const msg = `File is too large for in-function processing (${(sourceFile.file_size / 1024 / 1024).toFixed(1)} MB). ` +
        `Maximum for server function is ${MAX_FILE_SIZE_BYTES / 1024 / 1024} MB. ` +
        `For larger files, run the external audio worker (see worker/README.md).`;
      console.error(`[process-dialogue] File too large: ${msg}`);
      await supabase
        .from("processing_jobs")
        .update({ status: "failed", error_message: msg, completed_at: new Date().toISOString() })
        .eq("id", jobId);
      return new Response(JSON.stringify({ error: msg }), {
        status: 413,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await supabase
      .from("processing_jobs")
      .update({ progress: 10 })
      .eq("id", jobId);

    // Download the original file
    console.log(`[process-dialogue] Downloading source file from storage: ${sourceFile.storage_path}`);
    const { data: fileData, error: downloadError } = await supabase
      .storage
      .from("audio-files")
      .download(sourceFile.storage_path);

    if (downloadError || !fileData) {
      throw new Error(`Failed to download source file: ${downloadError?.message}`);
    }

    const arrayBuffer = await fileData.arrayBuffer();
    console.log(`[process-dialogue] Downloaded ${arrayBuffer.byteLength} bytes`);

    await supabase
      .from("processing_jobs")
      .update({ progress: 20 })
      .eq("id", jobId);

    // Parse WAV
    const wavData = parseWav(arrayBuffer);
    if (!wavData) {
      throw new Error("Failed to parse WAV file — unsupported format or encoding");
    }

    console.log(`[process-dialogue] Parsed: ${wavData.channels}ch, ${wavData.sampleRate}Hz, ${wavData.bitsPerSample}-bit, ${wavData.samples.length} samples`);
    const inputSampleCount = wavData.samples.length;

    await supabase
      .from("processing_jobs")
      .update({ progress: 30 })
      .eq("id", jobId);

    // Extract waveform peaks for the ORIGINAL file (if not already present)
    const originalPeaks = extractWaveformPeaks(wavData.samples, wavData.channels, 2000);
    await supabase
      .from("audio_files")
      .update({ waveform_data: originalPeaks })
      .eq("id", sourceFile.id);
    console.log(`[process-dialogue] Saved original waveform peaks: ${originalPeaks.length} buckets`);

    await supabase
      .from("processing_jobs")
      .update({ progress: 40 })
      .eq("id", jobId);

    // === DSP Processing ===
    // 1. High-pass filter at 70 Hz
    console.log(`[process-dialogue] Applying high-pass filter at ${HIGHPASS_FREQ_HZ} Hz`);
    let processed = applyHighPass(wavData.samples, wavData.sampleRate, HIGHPASS_FREQ_HZ);

    await supabase
      .from("processing_jobs")
      .update({ progress: 55 })
      .eq("id", jobId);

    // 2. Gentle compression
    console.log(`[process-dialogue] Applying compressor: threshold=${COMPRESSOR_THRESHOLD}, ratio=${COMPRESSOR_RATIO}`);
    processed = applyCompressor(
      processed,
      wavData.sampleRate,
      COMPRESSOR_THRESHOLD,
      COMPRESSOR_RATIO,
      COMPRESSOR_ATTACK_MS,
      COMPRESSOR_RELEASE_MS,
    );

    await supabase
      .from("processing_jobs")
      .update({ progress: 70 })
      .eq("id", jobId);

    // 3. Peak limiter
    console.log(`[process-dialogue] Applying limiter: ceiling=${LIMITER_CEILING}`);
    processed = applyLimiter(processed, LIMITER_CEILING, LIMITER_LOOKAHEAD_SAMPLES);

    // Duration check — output must have exactly the same sample count
    if (processed.length !== inputSampleCount) {
      throw new Error(`Duration mismatch: input had ${inputSampleCount} samples, output has ${processed.length}. ` +
        `The processed file must maintain exactly the same timeline duration as the source.`);
    }

    console.log(`[process-dialogue] Processing complete. Output samples: ${processed.length} (matches input: ${processed.length === inputSampleCount})`);

    await supabase
      .from("processing_jobs")
      .update({ progress: 80 })
      .eq("id", jobId);

    // Encode output WAV at 24-bit (or source bit depth if higher)
    const outputBitDepth = Math.max(24, wavData.bitsPerSample);
    const outputWavData: WavData = {
      ...wavData,
      samples: processed,
      bitsPerSample: outputBitDepth,
    };
    const outputBuffer = encodeWav(outputWavData, outputBitDepth);
    console.log(`[process-dialogue] Encoded output WAV: ${outputBuffer.byteLength} bytes, ${outputBitDepth}-bit`);

    // Upload processed file to storage
    const processedFilename = `processed_${Date.now()}.wav`;
    const { data: sourceFileRecord } = await supabase
      .from("audio_files")
      .select("user_id, project_id, original_filename")
      .eq("id", job.source_audio_file_id)
      .maybeSingle();

    const userId = sourceFileRecord?.user_id;
    const projectId = job.project_id;
    const outputPath = `${userId}/${projectId}/${processedFilename}`;

    console.log(`[process-dialogue] Uploading processed file to: ${outputPath}`);
    const { error: uploadError } = await supabase
      .storage
      .from("audio-files")
      .upload(outputPath, outputBuffer, { contentType: "audio/wav" });

    if (uploadError) {
      throw new Error(`Failed to upload processed file: ${uploadError.message}`);
    }

    await supabase
      .from("processing_jobs")
      .update({ progress: 90 })
      .eq("id", jobId);

    // Extract waveform peaks for processed file
    const processedPeaks = extractWaveformPeaks(processed, wavData.channels, 2000);

    // Create audio_files record for processed output
    const { data: processedAudioFile, error: insertError } = await supabase
      .from("audio_files")
      .insert({
        project_id: projectId,
        user_id: userId,
        original_filename: `processed_${sourceFileRecord?.original_filename ?? "output.wav"}`,
        storage_path: outputPath,
        type: "processed",
        duration_seconds: wavData.samples.length / (wavData.sampleRate * wavData.channels),
        sample_rate: wavData.sampleRate,
        bit_depth: outputBitDepth,
        channels: wavData.channels,
        file_size: outputBuffer.byteLength,
        waveform_data: processedPeaks,
      })
      .select("id")
      .maybeSingle();

    if (insertError || !processedAudioFile) {
      throw new Error(`Failed to create processed audio file record: ${insertError?.message}`);
    }

    console.log(`[process-dialogue] Created processed audio_files record: ${processedAudioFile.id}`);

    // Update job to completed
    await supabase
      .from("processing_jobs")
      .update({
        status: "completed",
        progress: 100,
        output_audio_file_id: processedAudioFile.id,
        completed_at: new Date().toISOString(),
      })
      .eq("id", jobId);

    console.log(`[process-dialogue] Job ${jobId} completed successfully`);

    return new Response(JSON.stringify({ success: true, outputAudioFileId: processedAudioFile.id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error(`[process-dialogue] Job ${jobId} failed:`, err);

    if (jobId) {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const supabase = createClient(supabaseUrl, serviceRoleKey);

      await supabase
        .from("processing_jobs")
        .update({
          status: "failed",
          error_message: err.message || "Unknown processing error",
          completed_at: new Date().toISOString(),
        })
        .eq("id", jobId);
    }

    return new Response(JSON.stringify({ error: err.message || "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
