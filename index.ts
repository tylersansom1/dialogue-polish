import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface WavFormatInfo {
  audioFormat: number;
  channels: number;
  sampleRate: number;
  byteRate: number;
  blockAlign: number;
  bitsPerSample: number;
  dataSize: number;
}

function parseWavHeader(buffer: ArrayBuffer): WavFormatInfo | null {
  const view = new DataView(buffer);

  // RIFF header
  const riff = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (riff !== "RIFF") return null;

  const wave = String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11));
  if (wave !== "WAVE") return null;

  // Iterate chunks starting at offset 12
  let offset = 12;
  let fmtInfo: WavFormatInfo | null = null;
  let dataSize = 0;

  while (offset + 8 <= buffer.byteLength) {
    const chunkId = String.fromCharCode(
      view.getUint8(offset),
      view.getUint8(offset + 1),
      view.getUint8(offset + 2),
      view.getUint8(offset + 3),
    );
    const chunkSize = view.getUint32(offset + 4, true);

    if (chunkId === "fmt ") {
      const fmtOffset = offset + 8;
      const audioFormat = view.getUint16(fmtOffset, true);
      const channels = view.getUint16(fmtOffset + 2, true);
      const sampleRate = view.getUint32(fmtOffset + 4, true);
      const byteRate = view.getUint32(fmtOffset + 8, true);
      const blockAlign = view.getUint16(fmtOffset + 12, true);
      const bitsPerSample = view.getUint16(fmtOffset + 14, true);

      fmtInfo = { audioFormat, channels, sampleRate, byteRate, blockAlign, bitsPerSample, dataSize: 0 };
    } else if (chunkId === "data") {
      dataSize = chunkSize;
    }

    // Move to next chunk (chunks are word-aligned)
    offset += 8 + chunkSize + (chunkSize % 2);
  }

  if (!fmtInfo) return null;
  fmtInfo.dataSize = dataSize;
  return fmtInfo;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const { audioFileId } = await req.json();

    if (!audioFileId) {
      return new Response(JSON.stringify({ error: "audioFileId is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Fetch the audio file record
    const { data: audioFile, error: dbError } = await supabase
      .from("audio_files")
      .select("id, storage_path, original_filename, file_size")
      .eq("id", audioFileId)
      .maybeSingle();

    if (dbError || !audioFile) {
      console.error("[extract-metadata] Failed to find audio file:", audioFileId, dbError);
      return new Response(JSON.stringify({ error: "Audio file not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[extract-metadata] Extracting metadata for: ${audioFile.original_filename} (${audioFile.storage_path})`);

    // Download the file using the Supabase client, which handles auth correctly
    const { data: fileData, error: downloadError } = await supabase.storage
      .from("audio-files")
      .download(audioFile.storage_path);

    if (downloadError || !fileData) {
      console.error("[extract-metadata] Failed to download file:", downloadError);
      return new Response(JSON.stringify({ error: "Failed to download file for metadata extraction" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Only the first 4KB is needed for the WAV header
    const headerBuffer = await fileData.slice(0, 4096).arrayBuffer();
    const wavInfo = parseWavHeader(headerBuffer);

    if (!wavInfo) {
      console.error("[extract-metadata] Invalid WAV header for file:", audioFile.original_filename);
      return new Response(JSON.stringify({ error: "File is not a valid WAV file" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[extract-metadata] Parsed WAV: ${wavInfo.channels}ch, ${wavInfo.sampleRate}Hz, ${wavInfo.bitsPerSample}-bit, data size: ${wavInfo.dataSize}`);

    return await finishMetadata(supabase, audioFile.id, wavInfo, audioFile.file_size, corsHeaders);
  } catch (err) {
    console.error("[extract-metadata] Unhandled error:", err);
    return new Response(JSON.stringify({ error: err.message || "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function finishMetadata(
  supabase: ReturnType<typeof createClient>,
  audioFileId: string,
  wavInfo: WavFormatInfo,
  fileSize: number,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  const durationSeconds = wavInfo.dataSize > 0
    ? wavInfo.dataSize / (wavInfo.sampleRate * wavInfo.channels * (wavInfo.bitsPerSample / 8))
    : 0;

  const metadata = {
    duration_seconds: Math.round(durationSeconds * 1000) / 1000,
    sample_rate: wavInfo.sampleRate,
    bit_depth: wavInfo.bitsPerSample,
    channels: wavInfo.channels,
    file_size: fileSize,
  };

  console.log(`[extract-metadata] Updating audio_files record ${audioFileId}:`, metadata);

  const { error: updateError } = await supabase
    .from("audio_files")
    .update(metadata)
    .eq("id", audioFileId);

  if (updateError) {
    console.error("[extract-metadata] Failed to update audio file record:", updateError);
    return new Response(JSON.stringify({ error: "Failed to save metadata" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  console.log(`[extract-metadata] Success for ${audioFileId}: duration=${metadata.duration_seconds}s`);

  return new Response(JSON.stringify({ success: true, metadata }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
