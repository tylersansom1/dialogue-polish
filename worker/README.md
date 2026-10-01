# Dialogue Polish Audio Worker

This is the real audio processing worker for Dialogue Polish. It runs on a server with FFmpeg installed, polls your Supabase database for queued processing jobs, downloads the original WAV file, processes it with real FFmpeg audio DSP, and uploads the processed result.

## What It Does

1. Polls the `processing_jobs` table every 5 seconds for jobs with status `queued`
2. Claims a job and downloads the original WAV from Supabase Storage
3. Processes the audio with FFmpeg:
   - **High-pass filter** at 70 Hz (removes low-frequency rumble)
   - **Gentle compression** (threshold: -10 dB, ratio: 2.5:1, attack: 10ms, release: 150ms)
   - **Peak limiter** at -1 dBFS (prevents clipping)
4. Verifies the output duration matches the input exactly (critical for film sync)
5. Generates real waveform peak data for both original and processed files
6. Uploads the processed WAV to Supabase Storage (never modifies the original)
7. Updates the job record to `completed` or `failed`

## Prerequisites

- Node.js 20 or later
- FFmpeg installed on the system
- Your Supabase project URL and service role key

## Option A: Run Locally

### 1. Install FFmpeg

**macOS:**
```
brew install ffmpeg
```

**Ubuntu/Debian:**
```
sudo apt-get update && sudo apt-get install -y ffmpeg
```

**Windows:**
Download from https://ffmpeg.org/download.html and add to your PATH.

### 2. Install Dependencies

```
cd worker
npm install
```

### 3. Set Environment Variables

Create a `.env` file in the `worker/` directory:

```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

You can find these values in your project's `.env` file:
- `VITE_SUPABASE_URL` → use as `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` → use as `SUPABASE_SERVICE_ROLE_KEY`

### 4. Start the Worker

```
npm start
```

You should see:
```
[worker] Dialogue Polish audio worker starting…
[worker] FFmpeg: ffmpeg version 7.x ...
[worker] Ready. Waiting for jobs…
```

## Option B: Deploy to Render.com (Recommended for Production)

Render is a managed hosting platform that runs the worker for you. You don't need to manage a server.

### 1. Push Your Project to GitHub

If your project isn't on GitHub yet, create a repository and push it. The `worker/` directory needs to be in the repo.

### 2. Create a New Web Service on Render

1. Go to https://dashboard.render.com and sign up / sign in
2. Click **New +** → **Web Service**
3. Connect your GitHub account and select your repository
4. Configure the service:
   - **Name:** dialogue-polish-worker
   - **Root Directory:** `worker`
   - **Runtime:** Docker
   - **Region:** Choose the closest to your Supabase project
   - **Instance Type:** Starter or higher (the free tier may not have enough memory for large files)

### 3. Set Environment Variables on Render

In the Render dashboard, under **Environment**, add these variables:

| Key | Value |
|-----|-------|
| `SUPABASE_URL` | Your Supabase project URL (from your `.env` file, the `VITE_SUPABASE_URL` value) |
| `SUPABASE_SERVICE_ROLE_KEY` | Your Supabase service role key (from your `.env` file) |

### 4. Deploy

Click **Create Web Service**. Render will build the Docker image (which installs FFmpeg automatically) and start the worker. You can view logs in the Render dashboard to confirm it's running.

The worker will automatically restart if it crashes and will start polling for jobs immediately.

## How to Test

1. Open your Dialogue Polish web app
2. Sign in and create a project
3. Upload a WAV file (any size — the worker handles large files)
4. Click **Process Dialogue**
5. The app creates a job with status `queued`
6. The worker picks it up within 5 seconds and processes it
7. The app polls for status updates and shows the processed audio when complete
8. Play both the original and processed audio to hear the difference
9. Download the processed WAV

## Processing Settings (Phase 1)

These are intentionally simple to verify the processing infrastructure works end to end. They are NOT the final professional dialogue algorithm.

| Setting | Value |
|---------|-------|
| High-pass filter | 70 Hz |
| Compressor threshold | -10 dB |
| Compressor ratio | 2.5:1 |
| Compressor attack | 10 ms |
| Compressor release | 150 ms |
| Limiter ceiling | -1.0 dBFS |
| Output format | WAV, same sample rate as input, 24-bit PCM minimum |

## Swapping the Processing Engine

The processing logic is isolated in the `processDialogue()` function in `index.js`. To use a different engine (Python DSP, Spotify Pedalboard, DeepFilterNet, ML models), replace that function while keeping the same interface:

```javascript
async function processDialogue(inputPath, outputPath, sampleRate, channels, bitDepth) {
  // Your custom processing here
  // Must write a valid WAV file to outputPath
  // Must preserve the exact timeline duration of the input
}
```

The web application never needs to change — it only knows about jobs and their status.
