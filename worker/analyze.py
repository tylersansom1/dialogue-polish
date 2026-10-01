#!/usr/bin/env python3
"""
Dialogue Analysis Engine — Phase 2

Analyzes a WAV file and produces a structured JSON report with real DSP measurements.
Each module runs independently; a failure in one module does not discard results from others.

Usage:
    python3 analyze.py <input_wav> <output_json>
"""

import sys
import os
import json
import math
import traceback
import warnings

warnings.filterwarnings("ignore")

import numpy as np
import soundfile as sf
import scipy.signal
try:
    import pyloudnorm as pyln
    HAVE_PLOUDNORM = True
except Exception:
    HAVE_PLOUDNORM = False


ANALYSIS_VERSION = "2.0.0"

# ---------------------------------------------------------------------------
# Utility
# ---------------------------------------------------------------------------

def db_from_linear(x):
    """Convert linear amplitude to dBFS."""
    if abs(x) < 1e-12:
        return -120.0
    return 20.0 * math.log10(abs(x))

def rms_db(samples):
    """RMS level in dBFS of a mono signal array."""
    if len(samples) == 0:
        return -120.0
    r = np.sqrt(np.mean(samples.astype(np.float64) ** 2))
    return db_from_linear(r)

def merge_regions(regions, gap=0.15):
    """Merge adjacent time regions that are close together."""
    if not regions:
        return []
    merged = [list(regions[0])]
    for s, e in regions[1:]:
        if s - merged[-1][1] <= gap:
            merged[-1][1] = e
        else:
            merged.append([s, e])
    return [(s, e) for s, e in merged]

def fmt_time(seconds):
    """Format seconds as HH:MM:SS.mmm for descriptions."""
    if seconds is None or seconds != seconds:  # NaN check
        return "unknown"
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = seconds % 60
    if h > 0:
        return f"{h}:{m:02d}:{s:06.3f}"
    return f"{m:02d}:{s:06.3f}"


# ---------------------------------------------------------------------------
# Module 1: File Technical Information
# ---------------------------------------------------------------------------

def analyze_file_info(audio, sample_rate, channels, duration, file_size, format_info):
    """Read and store technical file information."""
    try:
        info = {
            "duration_seconds": round(duration, 3),
            "sample_rate": sample_rate,
            "channels": channels,
            "bit_depth": format_info.get("bit_depth"),
            "codec": format_info.get("format"),
            "subtype": format_info.get("subtype"),
            "file_size": file_size,
            "frame_count": len(audio),
            "is_48khz": sample_rate == 48000,
            "format_flag": None,
        }
        if sample_rate != 48000:
            info["format_flag"] = f"Non-standard sample rate: {sample_rate} Hz. Film dialogue typically uses 48 kHz."
        if channels > 2:
            info["format_flag"] = (info["format_flag"] or "") + f" Unusual channel count: {channels}."
        return {"status": "success", "data": info}
    except Exception as e:
        return {"status": "failed", "error": str(e)}


# ---------------------------------------------------------------------------
# Module 2: Loudness Analysis (ITU-R BS.1770 / EBU R128)
# ---------------------------------------------------------------------------

def analyze_loudness(audio, sample_rate, channels, duration):
    """Measure integrated LUFS, LRA, true peak, max momentary, max short-term."""
    try:
        if not HAVE_PLOUDNORM:
            return {"status": "failed", "error": "pyloudnorm not available"}

        # pyloudnorm expects shape (n_frames, channels) as float
        if channels == 1:
            data = audio.reshape(-1, 1)
        else:
            data = audio

        meter = pyln.Meter(sample_rate)
        integrated = meter.integrated_loudness(data)

        # Loudness range
        try:
            lra = meter.loudness_range(data)
        except Exception:
            lra = None

        # True peak
        try:
            true_peak = meter.true_peak(data)
        except Exception:
            true_peak = None

        # Momentary (400ms windows) and short-term (3s windows)
        # Use pyloudnorm's internal block-gating
        momentary_values = []
        short_term_values = []

        # Momentary: 400ms hop 100ms
        m_block = int(0.400 * sample_rate)
        m_hop = int(0.100 * sample_rate)
        for i in range(0, len(data) - m_block + 1, m_hop):
            block = data[i:i + m_block]
            try:
                val = meter.integrated_loudness(block)
                if val != float('-inf') and not math.isnan(val):
                    momentary_values.append(val)
            except Exception:
                pass

        # Short-term: 3s hop 1s
        s_block = int(3.0 * sample_rate)
        s_hop = int(1.0 * sample_rate)
        for i in range(0, len(data) - s_block + 1, s_hop):
            block = data[i:i + s_block]
            try:
                val = meter.integrated_loudness(block)
                if val != float('-inf') and not math.isnan(val):
                    short_term_values.append(val)
            except Exception:
                pass

        max_momentary = max(momentary_values) if momentary_values else None
        max_short_term = max(short_term_values) if short_term_values else None

        # RMS average
        if channels == 1:
            mono = audio
        else:
            mono = audio.mean(axis=1)
        rms_avg = rms_db(mono)

        return {
            "status": "success",
            "data": {
                "integrated_lufs": round(integrated, 1) if not math.isnan(integrated) else None,
                "loudness_range": round(lra, 1) if lra is not None else None,
                "true_peak_dbtp": round(true_peak, 1) if true_peak is not None else None,
                "maximum_momentary_lufs": round(max_momentary, 1) if max_momentary is not None else None,
                "maximum_short_term_lufs": round(max_short_term, 1) if max_short_term is not None else None,
                "rms_average_dbfs": round(rms_avg, 1),
            },
        }
    except Exception as e:
        return {"status": "failed", "error": str(e)}


# ---------------------------------------------------------------------------
# Module 3: Peak Analysis
# ---------------------------------------------------------------------------

def analyze_peaks(audio, sample_rate, channels, duration):
    """Detect sample peak, clipped samples, near-clipping events."""
    try:
        if channels == 1:
            mono = audio
        else:
            mono = audio.mean(axis=1)

        abs_samples = np.abs(mono)
        sample_peak_linear = float(np.max(abs_samples))
        sample_peak_db = db_from_linear(sample_peak_linear)

        # Clipping: samples at or very near digital full scale (>= 0.999)
        clip_threshold = 0.999
        near_clip_threshold = 0.9  # ~-0.92 dBFS

        clipped_mask = abs_samples >= clip_threshold
        near_clip_mask = (abs_samples >= near_clip_threshold) & (abs_samples < clip_threshold)

        # Find clipping events (runs of clipped samples)
        clip_events = []
        in_event = False
        event_start = 0
        for i in range(len(clipped_mask)):
            if clipped_mask[i] and not in_event:
                in_event = True
                event_start = i
            elif not clipped_mask[i] and in_event:
                in_event = False
                start_t = event_start / sample_rate
                end_t = i / sample_rate
                clip_events.append((start_t, end_t))
        if in_event:
            clip_events.append((event_start / sample_rate, len(clipped_mask) / sample_rate))

        # Near-clipping events (merge consecutive)
        near_clip_events = []
        in_event = False
        event_start = 0
        for i in range(len(near_clip_mask)):
            if near_clip_mask[i] and not in_event:
                in_event = True
                event_start = i
            elif not near_clip_mask[i] and in_event:
                in_event = False
                start_t = event_start / sample_rate
                end_t = i / sample_rate
                # Only count if the run is at least 10 samples
                if i - event_start >= 10:
                    near_clip_events.append((start_t, end_t))
        if in_event and len(near_clip_mask) - event_start >= 10:
            near_clip_events.append((event_start / sample_rate, len(near_clip_mask) / sample_rate))

        return {
            "status": "success",
            "data": {
                "sample_peak_linear": round(sample_peak_linear, 6),
                "sample_peak_dbfs": round(sample_peak_db, 2),
                "clipping_count": len(clip_events),
                "clipping_events": [{"start": round(s, 3), "end": round(e, 3)} for s, e in clip_events[:50]],
                "near_clipping_count": len(near_clip_events),
                "near_clipping_events": [{"start": round(s, 3), "end": round(e, 3)} for s, e in near_clip_events[:50]],
            },
        }
    except Exception as e:
        return {"status": "failed", "error": str(e)}


# ---------------------------------------------------------------------------
# Module 4: Dialogue Level Consistency
# ---------------------------------------------------------------------------

def analyze_level_consistency(audio, sample_rate, channels, duration, integrated_lufs):
    """Analyze how much dialogue level varies over time."""
    try:
        if not HAVE_PLOUDNORM or integrated_lufs is None:
            return {"status": "skipped", "error": "Requires loudness analysis"}

        if channels == 1:
            data = audio.reshape(-1, 1)
        else:
            data = audio

        meter = pyln.Meter(sample_rate)

        # Short-term loudness: 3s windows, 1s hop
        block_size = int(3.0 * sample_rate)
        hop = int(1.0 * sample_rate)
        st_values = []
        st_times = []
        for i in range(0, len(data) - block_size + 1, hop):
            block = data[i:i + block_size]
            try:
                val = meter.integrated_loudness(block)
                if val != float('-inf') and not math.isnan(val):
                    st_values.append(val)
                    st_times.append(i / sample_rate)
            except Exception:
                pass

        if len(st_values) < 2:
            return {"status": "success", "data": {"regions": [], "variation": None}}

        st_arr = np.array(st_values)
        variation = float(np.std(st_arr))

        # Flag windows significantly below or above integrated
        low_threshold = integrated_lufs - 3.0  # 3 LU below average
        high_threshold = integrated_lufs + 3.0  # 3 LU above average

        low_regions = []
        high_regions = []
        for i, (t, val) in enumerate(zip(st_times, st_values)):
            if val < low_threshold:
                low_regions.append((t, t + 3.0))
            elif val > high_threshold:
                high_regions.append((t, t + 3.0))

        # Detect sudden level jumps
        jump_regions = []
        jump_threshold = 6.0  # 6 LU between adjacent windows
        for i in range(1, len(st_values)):
            diff = abs(st_values[i] - st_values[i - 1])
            if diff > jump_threshold:
                t = st_times[i]
                jump_regions.append((t, t + 1.0))

        return {
            "status": "success",
            "data": {
                "short_term_values": [round(v, 1) for v in st_values],
                "short_term_times": [round(t, 3) for t in st_times],
                "variation_lu": round(variation, 2),
                "low_dialogue_regions": [{"start": round(s, 3), "end": round(e, 3)} for s, e in merge_regions(low_regions)],
                "high_dialogue_regions": [{"start": round(s, 3), "end": round(e, 3)} for s, e in merge_regions(high_regions)],
                "level_jump_regions": [{"start": round(s, 3), "end": round(e, 3)} for s, e in merge_regions(jump_regions)],
            },
        }
    except Exception as e:
        return {"status": "failed", "error": str(e)}


# ---------------------------------------------------------------------------
# Module 5: Noise Floor
# ---------------------------------------------------------------------------

def analyze_noise_floor(audio, sample_rate, channels, duration):
    """Estimate noise floor from low-energy segments."""
    try:
        if channels == 1:
            mono = audio
        else:
            mono = audio.mean(axis=1)

        # Compute RMS in 400ms windows
        win = int(0.400 * sample_rate)
        hop = int(0.100 * sample_rate)
        rms_values = []
        rms_times = []
        for i in range(0, len(mono) - win + 1, hop):
            block = mono[i:i + win]
            r = np.sqrt(np.mean(block ** 2))
            rms_values.append(r)
            rms_times.append(i / sample_rate)

        if not rms_values:
            return {"status": "success", "data": {"estimated_noise_floor_dbfs": None}}

        rms_arr = np.array(rms_values)
        # Exclude silent windows (below -70 dBFS) for noise floor estimation
        rms_db_arr = np.array([db_from_linear(r) for r in rms_arr])
        non_silent = rms_db_arr[rms_db_arr > -70.0]

        if len(non_silent) == 0:
            return {"status": "success", "data": {"estimated_noise_floor_dbfs": None}}

        # Noise floor = 10th percentile of non-silent RMS
        noise_floor_db = float(np.percentile(non_silent, 10))
        noise_floor_variation = float(np.std(non_silent[non_silent <= np.percentile(non_silent, 30)]))

        # Find unusually noisy sections (energy close to noise floor for extended periods)
        noisy_regions = []
        threshold = noise_floor_db + 6.0
        in_region = False
        region_start = 0
        for i, (t, db_val) in enumerate(zip(rms_times, rms_db_arr)):
            if db_val < threshold and db_val > -70.0 and not in_region:
                in_region = True
                region_start = t
            elif (db_val >= threshold or db_val <= -70.0) and in_region:
                in_region = False
                if t - region_start >= 0.5:  # at least 0.5s
                    noisy_regions.append((region_start, t))
        if in_region and rms_times[-1] - region_start >= 0.5:
            noisy_regions.append((region_start, rms_times[-1]))

        return {
            "status": "success",
            "data": {
                "estimated_noise_floor_dbfs": round(noise_floor_db, 1),
                "noise_floor_variation_db": round(noise_floor_variation, 2),
                "noisy_regions": [{"start": round(s, 3), "end": round(e, 3)} for s, e in noisy_regions[:50]],
                "rms_window_db": [round(v, 1) for v in rms_db_arr[:500]],
            },
        }
    except Exception as e:
        return {"status": "failed", "error": str(e)}


# ---------------------------------------------------------------------------
# Module 6: Hum Detection
# ---------------------------------------------------------------------------

def analyze_hum(audio, sample_rate, channels, duration):
    """Detect electrical hum at 50/60 Hz and harmonics."""
    try:
        if channels == 1:
            mono = audio
        else:
            mono = audio.mean(axis=1)

        # Use a long FFT on the entire file for frequency resolution
        # For very long files, use a representative segment (first 60s or middle 60s)
        max_samples = min(len(mono), int(60.0 * sample_rate))
        if len(mono) > max_samples:
            start = len(mono) // 2 - max_samples // 2
            segment = mono[start:start + max_samples]
        else:
            segment = mono

        # Remove DC before FFT
        segment = segment - np.mean(segment)

        # FFT with windowing
        n_fft = 2 ** int(math.ceil(math.log2(len(segment))))
        if n_fft < 8192:
            n_fft = 8192

        window = np.hanning(len(segment))
        fft_data = np.fft.rfft(segment * window, n=n_fft)
        magnitude = np.abs(fft_data)
        freqs = np.fft.rfftfreq(n_fft, d=1.0 / sample_rate)

        # Check 50 Hz and 60 Hz fundamentals and harmonics
        results = {}
        for fundamental in [50, 60]:
            harmonics_to_check = [fundamental * h for h in range(1, 7)]
            harmonic_strengths = []
            for freq in harmonics_to_check:
                if freq >= sample_rate / 2:
                    break
                # Find the bin closest to the target frequency
                idx = np.argmin(np.abs(freqs - freq))
                # Get the magnitude at that bin and surrounding bins for robustness
                bin_mag = magnitude[idx]
                # Compare to the median magnitude in a +/-5 Hz window excluding the hum bin
                window_indices = np.where((freqs > freq - 5) & (freqs < freq + 5))[0]
                window_indices = window_indices[window_indices != idx]
                if len(window_indices) > 0:
                    median_mag = np.median(magnitude[window_indices])
                else:
                    median_mag = 1e-10

                if median_mag > 0:
                    ratio = bin_mag / median_mag
                else:
                    ratio = 0.0

                harmonic_strengths.append({
                    "frequency": freq,
                    "amplitude_ratio": round(float(ratio), 2),
                })

            # Confidence: ratio of fundamental to surrounding bins
            fundamental_ratio = harmonic_strengths[0]["amplitude_ratio"] if harmonic_strengths else 0
            # Check if at least 2 harmonics are also elevated
            elevated_harmonics = sum(1 for h in harmonic_strengths[1:] if h["amplitude_ratio"] > 2.0)

            confidence = min(1.0, fundamental_ratio / 10.0)
            detected = fundamental_ratio > 3.0 and elevated_harmonics >= 1

            results[f"{fundamental}hz"] = {
                "detected": detected,
                "fundamental_ratio": round(fundamental_ratio, 2),
                "harmonics": harmonic_strengths,
                "elevated_harmonics_count": elevated_harmonics,
                "confidence": round(confidence, 2),
            }

        # Determine which is dominant
        detected_hum = None
        for freq_label, data in results.items():
            if data["detected"]:
                if detected_hum is None or data["fundamental_ratio"] > detected_hum["fundamental_ratio"]:
                    detected_hum = {"frequency": int(freq_label.replace("hz", "")), **data}

        return {
            "status": "success",
            "data": {
                "results": results,
                "detected_hum": detected_hum,
            },
        }
    except Exception as e:
        return {"status": "failed", "error": str(e)}


# ---------------------------------------------------------------------------
# Module 7: Spectral Analysis
# ---------------------------------------------------------------------------

def analyze_spectrum(audio, sample_rate, channels, duration):
    """Analyze overall spectral balance across frequency bands."""
    try:
        if channels == 1:
            mono = audio
        else:
            mono = audio.mean(axis=1)

        # Use Welch's method for spectral estimation
        nperseg = min(8192, len(mono))
        if nperseg < 256:
            return {"status": "success", "data": {"bands": {}}}

        freqs, psd = scipy.signal.welch(mono, fs=sample_rate, nperseg=nperseg)

        # Integrate energy into bands
        bands = {
            "sub_rumble": (20, 60),
            "low_bass": (60, 120),
            "low_mids": (120, 500),
            "mids": (500, 2000),
            "presence": (2000, 4000),
            "upper_presence": (4000, 8000),
            "air": (8000, 20000),
        }

        band_energies = {}
        total_energy = 0.0
        for name, (f_low, f_high) in bands.items():
            mask = (freqs >= f_low) & (freqs < f_high)
            if np.any(mask):
                # Integrate PSD over the band (approximate)
                energy = float(np.trapz(psd[mask], freqs[mask]))
            else:
                energy = 0.0
            band_energies[name] = round(energy, 8)
            total_energy += energy

        # Convert to relative energy (percentage)
        band_relative = {}
        if total_energy > 0:
            for name, energy in band_energies.items():
                band_relative[name] = round(energy / total_energy * 100, 2)

        return {
            "status": "success",
            "data": {
                "bands": band_relative,
                "absolute_bands": band_energies,
                "sample_rate": sample_rate,
            },
        }
    except Exception as e:
        return {"status": "failed", "error": str(e)}


# ---------------------------------------------------------------------------
# Module 8: Rumble Detection
# ---------------------------------------------------------------------------

def analyze_rumble(audio, sample_rate, channels, duration):
    """Detect excessive low-frequency energy in non-speech sections."""
    try:
        if channels == 1:
            mono = audio
        else:
            mono = audio.mean(axis=1)

        # Compute energy below 60 Hz in 1-second windows
        win = int(1.0 * sample_rate)
        hop = int(0.5 * sample_rate)

        rumble_regions = []
        rumble_values = []

        for i in range(0, len(mono) - win + 1, hop):
            block = mono[i:i + win]
            # Low-pass via FFT: extract energy below 60 Hz
            n = len(block)
            fft_block = np.fft.rfft(block)
            freqs = np.fft.rfftfreq(n, d=1.0 / sample_rate)
            low_mask = freqs < 60
            low_energy = np.sum(np.abs(fft_block[low_mask]) ** 2)
            total_energy = np.sum(np.abs(fft_block) ** 2)

            if total_energy > 0:
                low_ratio = low_energy / total_energy
            else:
                low_ratio = 0.0

            rumble_values.append(low_ratio)
            t = i / sample_rate
            rumble_values.append(low_ratio)

        if not rumble_values:
            return {"status": "success", "data": {"rumble_regions": []}}

        rumble_arr = np.array(rumble_values[::2])  # every other (we appended twice)
        rumble_times = [i * hop / sample_rate for i in range(len(rumble_arr))]

        # Flag windows where sub-60Hz energy is >15% of total
        rumble_threshold = 0.15
        rumble_regions = []
        for i, (t, ratio) in enumerate(zip(rumble_times, rumble_arr)):
            if ratio > rumble_threshold:
                rumble_regions.append((t, t + 1.0))

        return {
            "status": "success",
            "data": {
                "rumble_regions": [{"start": round(s, 3), "end": round(e, 3)} for s, e in merge_regions(rumble_regions)],
                "avg_low_freq_ratio": round(float(np.mean(rumble_arr)), 4),
            },
        }
    except Exception as e:
        return {"status": "failed", "error": str(e)}


# ---------------------------------------------------------------------------
# Module 9: Harshness / Sibilance Analysis
# ---------------------------------------------------------------------------

def analyze_harshness_sibilance(audio, sample_rate, channels, duration):
    """Identify excessive energy in harshness and sibilance frequency ranges."""
    try:
        if channels == 1:
            mono = audio
        else:
            mono = audio.mean(axis=1)

        # Compute spectrogram
        nperseg = min(2048, len(mono))
        if nperseg < 256:
            return {"status": "success", "data": {"harshness_regions": [], "sibilance_regions": []}}

        f, t_spec, Sxx = scipy.signal.spectrogram(mono, fs=sample_rate, nperseg=nperseg, noverlap=nperseg // 2)

        # Total energy per time frame
        total_energy = Sxx.sum(axis=0)
        total_energy[total_energy == 0] = 1e-12

        # Harshness band: 2-5 kHz
        harsh_mask = (f >= 2000) & (f < 5000)
        harsh_energy = Sxx[harsh_mask].sum(axis=0)
        harsh_ratio = harsh_energy / total_energy

        # Sibilance band: 5-9 kHz
        sib_mask = (f >= 5000) & (f < 9000)
        sib_energy = Sxx[sib_mask].sum(axis=0)
        sib_ratio = sib_energy / total_energy

        # Compute thresholds from distribution
        harsh_median = np.median(harsh_ratio)
        sib_median = np.median(sib_ratio)

        # Flag frames where the ratio is significantly above the median
        harsh_threshold = harsh_median * 2.5 if harsh_median > 0 else 0.3
        sib_threshold = sib_median * 2.5 if sib_median > 0 else 0.2

        harsh_regions = []
        for i, (time_val, ratio) in enumerate(zip(t_spec, harsh_ratio)):
            if ratio > harsh_threshold:
                harsh_regions.append((time_val, time_val + (t_spec[1] - t_spec[0] if len(t_spec) > 1 else 0.1)))

        sib_regions = []
        for i, (time_val, ratio) in enumerate(zip(t_spec, sib_ratio)):
            if ratio > sib_threshold:
                sib_regions.append((time_val, time_val + (t_spec[1] - t_spec[0] if len(t_spec) > 1 else 0.1)))

        return {
            "status": "success",
            "data": {
                "harshness_regions": [{"start": round(s, 3), "end": round(e, 3)} for s, e in merge_regions(harsh_regions, gap=0.3)][:50],
                "sibilance_regions": [{"start": round(s, 3), "end": round(e, 3)} for s, e in merge_regions(sib_regions, gap=0.3)][:50],
                "harshness_median_ratio": round(float(harsh_median), 4),
                "sibilance_median_ratio": round(float(sib_median), 4),
            },
        }
    except Exception as e:
        return {"status": "failed", "error": str(e)}


# ---------------------------------------------------------------------------
# Module 10: Resonance Detection
# ---------------------------------------------------------------------------

def analyze_resonance(audio, sample_rate, channels, duration):
    """Identify narrow frequency buildups indicating room or mic resonances."""
    try:
        if channels == 1:
            mono = audio
        else:
            mono = audio.mean(axis=1)

        nperseg = min(8192, len(mono))
        if nperseg < 512:
            return {"status": "success", "data": {"resonances": []}}

        freqs, psd = scipy.signal.welch(mono, fs=sample_rate, nperseg=nperseg)

        # Find peaks in the spectrum
        # Use a moderate prominence to find actual resonances
        peaks, properties = scipy.signal.find_peaks(
            psd,
            prominence=np.median(psd) * 3,
            distance=int(sample_rate / nperseg * 50),  # at least 50 Hz apart
        )

        if len(peaks) == 0:
            return {"status": "success", "data": {"resonances": []}}

        # Sort by prominence
        prominences = properties["prominences"]
        sorted_idx = np.argsort(prominences)[::-1]

        resonances = []
        for idx in sorted_idx[:10]:  # top 10
            peak_idx = peaks[idx]
            center_freq = float(freqs[peak_idx])
            peak_height = float(psd[peak_idx])
            prominence = float(prominences[idx])

            # Estimate bandwidth at half prominence
            half_height = psd[peak_idx] - prominence / 2
            # Search left
            left = peak_idx
            while left > 0 and psd[left] > half_height:
                left -= 1
            right = peak_idx
            while right < len(psd) - 1 and psd[right] > half_height:
                right += 1

            bandwidth = float(freqs[right] - freqs[left])

            # Strength relative to median
            strength = float(peak_height / (np.median(psd) + 1e-12))

            resonances.append({
                "center_frequency_hz": round(center_freq, 1),
                "bandwidth_hz": round(bandwidth, 1),
                "strength": round(strength, 2),
            })

        return {
            "status": "success",
            "data": {"resonances": resonances},
        }
    except Exception as e:
        return {"status": "failed", "error": str(e)}


# ---------------------------------------------------------------------------
# Module 11: Dynamic Range
# ---------------------------------------------------------------------------

def analyze_dynamics(audio, sample_rate, channels, duration, sample_peak_linear):
    """Analyze dialogue dynamics: crest factor, dynamic range, variation."""
    try:
        if channels == 1:
            mono = audio
        else:
            mono = audio.mean(axis=1)

        # RMS of entire file
        rms_linear = float(np.sqrt(np.mean(mono ** 2)))
        rms_db = db_from_linear(rms_linear)
        peak_db = db_from_linear(sample_peak_linear)

        crest_factor = peak_db - rms_db if rms_db > -120 else None

        # Compute RMS in 400ms windows for dynamic range estimation
        win = int(0.400 * sample_rate)
        hop = int(0.100 * sample_rate)
        window_rms = []
        for i in range(0, len(mono) - win + 1, hop):
            block = mono[i:i + win]
            r = np.sqrt(np.mean(block ** 2))
            window_rms.append(db_from_linear(r))

        if not window_rms:
            return {"status": "success", "data": {"crest_factor_db": crest_factor}}

        rms_arr = np.array(window_rms)
        # Dynamic range: difference between 10th loudest and average RMS
        sorted_rms = np.sort(rms_arr)[::-1]  # descending
        top_10 = sorted_rms[:max(1, len(sorted_rms) // 100)]  # top 1%
        avg_top = float(np.mean(top_10))
        avg_rms = float(np.mean(rms_arr))
        dynamic_range = avg_top - avg_rms if avg_rms > -120 else None

        # Quiet-to-loud variation
        quiet_to_loud = float(sorted_rms[0] - sorted_rms[-1]) if len(sorted_rms) > 1 else None

        return {
            "status": "success",
            "data": {
                "crest_factor_db": round(crest_factor, 2) if crest_factor is not None else None,
                "dynamic_range_db": round(dynamic_range, 2) if dynamic_range is not None else None,
                "quiet_to_loud_variation_db": round(quiet_to_loud, 2) if quiet_to_loud is not None else None,
                "average_rms_dbfs": round(avg_rms, 2),
            },
        }
    except Exception as e:
        return {"status": "failed", "error": str(e)}


# ---------------------------------------------------------------------------
# Module 12: Silence / Gaps Detection
# ---------------------------------------------------------------------------

def analyze_silence(audio, sample_rate, channels, duration):
    """Detect silence, near-silence, and room tone regions."""
    try:
        if channels == 1:
            mono = audio
        else:
            mono = audio.mean(axis=1)

        # Energy in 100ms windows
        win = int(0.100 * sample_rate)
        hop = int(0.050 * sample_rate)

        energy = []
        times = []
        for i in range(0, len(mono) - win + 1, hop):
            block = mono[i:i + win]
            r = np.sqrt(np.mean(block ** 2))
            energy.append(db_from_linear(r))
            times.append(i / sample_rate)

        if not energy:
            return {"status": "success", "data": {"silence_regions": [], "near_silence_regions": []}}

        energy_arr = np.array(energy)

        # Silence: below -60 dBFS
        # Near-silence: between -60 and -50 dBFS
        silence_threshold = -60.0
        near_silence_threshold = -50.0

        silence_regions = []
        near_silence_regions = []

        in_silence = False
        in_near = False
        s_start = 0
        n_start = 0

        for i, (t, e) in enumerate(zip(times, energy_arr)):
            if e < silence_threshold:
                if not in_silence:
                    in_silence = True
                    s_start = t
                if in_near:
                    in_near = False
                    if t - n_start >= 0.3:
                        near_silence_regions.append((n_start, t))
            elif e < near_silence_threshold:
                if in_silence:
                    in_silence = False
                    if t - s_start >= 0.3:
                        silence_regions.append((s_start, t))
                if not in_near:
                    in_near = True
                    n_start = t
            else:
                if in_silence:
                    in_silence = False
                    if t - s_start >= 0.3:
                        silence_regions.append((s_start, t))
                if in_near:
                    in_near = False
                    if t - n_start >= 0.3:
                        near_silence_regions.append((n_start, t))

        # Close any open regions
        end_t = times[-1] + 0.1
        if in_silence and end_t - s_start >= 0.3:
            silence_regions.append((s_start, end_t))
        if in_near and end_t - n_start >= 0.3:
            near_silence_regions.append((n_start, end_t))

        return {
            "status": "success",
            "data": {
                "silence_regions": [{"start": round(s, 3), "end": round(e, 3)} for s, e in silence_regions[:100]],
                "near_silence_regions": [{"start": round(s, 3), "end": round(e, 3)} for s, e in near_silence_regions[:100]],
                "silence_threshold_dbfs": silence_threshold,
                "near_silence_threshold_dbfs": near_silence_threshold,
            },
        }
    except Exception as e:
        return {"status": "failed", "error": str(e)}


# ---------------------------------------------------------------------------
# Module 13: DC Offset
# ---------------------------------------------------------------------------

def analyze_dc_offset(audio, sample_rate, channels, duration):
    """Detect measurable DC offset."""
    try:
        if channels == 1:
            dc_offset = float(np.mean(audio))
        else:
            dc_offset = [float(np.mean(audio[:, c])) for c in range(channels)]
            dc_offset = dc_offset[0]  # report first channel's DC offset in structured column

        dc_db = db_from_linear(abs(dc_offset)) if abs(dc_offset) > 1e-8 else -120.0
        is_significant = abs(dc_offset) > 0.001  # ~-60 dBFS

        return {
            "status": "success",
            "data": {
                "dc_offset_linear": round(dc_offset, 8),
                "dc_offset_db": round(dc_db, 2),
                "is_significant": is_significant,
            },
        }
    except Exception as e:
        return {"status": "failed", "error": str(e)}


# ---------------------------------------------------------------------------
# Module 14: Phase / Channel Analysis (stereo only)
# ---------------------------------------------------------------------------

def analyze_phase(audio, sample_rate, channels, duration):
    """For stereo files: L/R balance, phase correlation, polarity problems."""
    try:
        if channels < 2:
            return {"status": "skipped", "data": {"reason": "Mono file — no phase analysis"}}

        left = audio[:, 0]
        right = audio[:, 1]

        # L/R level balance
        left_rms = np.sqrt(np.mean(left ** 2))
        right_rms = np.sqrt(np.mean(right ** 2))
        balance_db = db_from_linear(left_rms / (right_rms + 1e-12)) if right_rms > 0 else 0.0

        # Phase correlation (normalized cross-correlation)
        # Use a windowed approach for efficiency on long files
        max_samples = min(len(left), int(60.0 * sample_rate))
        l = left[:max_samples]
        r = right[:max_samples]

        l_norm = l - np.mean(l)
        r_norm = r - np.mean(r)

        denom = np.sqrt(np.sum(l_norm ** 2) * np.sum(r_norm ** 2))
        if denom > 0:
            correlation = float(np.sum(l_norm * r_norm) / denom)
        else:
            correlation = 0.0

        # Check for polarity inversion
        polarity_inverted = correlation < -0.8

        # Channel imbalance: significant if > 3 dB
        imbalance_significant = abs(balance_db) > 3.0

        return {
            "status": "success",
            "data": {
                "left_rms_dbfs": round(db_from_linear(left_rms), 2),
                "right_rms_dbfs": round(db_from_linear(right_rms), 2),
                "balance_db": round(balance_db, 2),
                "imbalance_significant": imbalance_significant,
                "phase_correlation": round(correlation, 3),
                "polarity_inverted": polarity_inverted,
            },
        }
    except Exception as e:
        return {"status": "failed", "error": str(e)}


# ---------------------------------------------------------------------------
# Module 15: Speech Detection
# ---------------------------------------------------------------------------

def analyze_speech(audio, sample_rate, channels, duration):
    """Energy-based VAD with spectral flatness to distinguish speech from noise."""
    try:
        if channels == 1:
            mono = audio
        else:
            mono = audio.mean(axis=1)

        # 30ms frames with 10ms hop for VAD
        frame_size = int(0.030 * sample_rate)
        hop_size = int(0.010 * sample_rate)

        if len(mono) < frame_size:
            return {"status": "success", "data": {"speech_regions": [], "speech_percentage": 0.0}}

        # Energy threshold: adaptively set based on the file's energy distribution
        frame_energies = []
        frame_flatness = []
        frame_times = []

        for i in range(0, len(mono) - frame_size + 1, hop_size):
            frame = mono[i:i + frame_size]
            energy = np.sqrt(np.mean(frame ** 2))
            frame_energies.append(energy)
            frame_times.append(i / sample_rate)

            # Spectral flatness (Wiener entropy)
            fft_frame = np.abs(np.fft.rfft(frame * np.hanning(len(frame))))
            geo_mean = np.exp(np.mean(np.log(fft_frame + 1e-12)))
            arith_mean = np.mean(fft_frame)
            flatness = geo_mean / (arith_mean + 1e-12) if arith_mean > 0 else 0
            frame_flatness.append(flatness)

        frame_energies = np.array(frame_energies)
        frame_flatness = np.array(frame_flatness)
        frame_times = np.array(frame_times)

        # Adaptive energy threshold: 20th percentile of energies
        energy_threshold = np.percentile(frame_energies, 20) * 3

        # Speech: high enough energy AND not too flat (spectral structure = harmonic content)
        flatness_threshold = 0.3  # below this = structured spectrum (likely speech)

        is_speech = (frame_energies > energy_threshold) & (frame_flatness < flatness_threshold)

        # Merge speech frames into regions
        speech_regions = []
        in_speech = False
        region_start = 0
        for i in range(len(is_speech)):
            if is_speech[i] and not in_speech:
                in_speech = True
                region_start = frame_times[i]
            elif not is_speech[i] and in_speech:
                in_speech = False
                end_t = frame_times[i]
                if end_t - region_start >= 0.2:  # at least 200ms
                    speech_regions.append((region_start, end_t))
        if in_speech:
            end_t = frame_times[-1] + 0.03
            if end_t - region_start >= 0.2:
                speech_regions.append((region_start, end_t))

        speech_duration = sum(e - s for s, e in speech_regions)
        speech_percentage = (speech_duration / duration * 100) if duration > 0 else 0.0

        return {
            "status": "success",
            "data": {
                "speech_regions": [{"start": round(s, 3), "end": round(e, 3)} for s, e in speech_regions[:200]],
                "speech_percentage": round(speech_percentage, 1),
                "speech_duration_seconds": round(speech_duration, 3),
            },
        }
    except Exception as e:
        return {"status": "failed", "error": str(e)}


# ---------------------------------------------------------------------------
# Issue Generation: Convert analysis results to structured issues
# ---------------------------------------------------------------------------

def generate_issues(results, duration):
    """Generate a list of issues from the analysis module results."""
    issues = []

    def add_issue(issue_type, severity, start, end, description, center_freq=None,
                  measured=None, threshold=None, confidence=0.8):
        issues.append({
            "issue_type": issue_type,
            "severity": severity,
            "start_time": round(start, 3) if start is not None else None,
            "end_time": round(end, 3) if end is not None else None,
            "center_frequency": round(center_freq, 1) if center_freq is not None else None,
            "measured_value": round(measured, 3) if measured is not None else None,
            "threshold_value": round(threshold, 3) if threshold is not None else None,
            "description": description,
            "confidence": round(confidence, 2),
        })

    # Clipping issues
    peak_data = results.get("peaks", {}).get("data", {})
    for event in peak_data.get("clipping_events", []):
        add_issue("clipping", "significant", event["start"], event["end"],
                  f"Digital clipping detected at {fmt_time(event['start'])}. Samples at full scale.",
                  confidence=0.95)

    for event in peak_data.get("near_clipping_events", []):
        add_issue("near_clipping", "moderate", event["start"], event["end"],
                  f"Near-clipping detected at {fmt_time(event['start'])}. Samples above -0.5 dBFS.",
                  confidence=0.85)

    # Level consistency issues
    level_data = results.get("level_consistency", {}).get("data", {})
    for region in level_data.get("low_dialogue_regions", []):
        add_issue("low_dialogue", "moderate", region["start"], region["end"],
                  f"Dialogue significantly quieter than surrounding material ({fmt_time(region['start'])} - {fmt_time(region['end'])}).",
                  confidence=0.7)
    for region in level_data.get("high_dialogue_regions", []):
        add_issue("high_dialogue", "moderate", region["start"], region["end"],
                  f"Dialogue significantly louder than surrounding material ({fmt_time(region['start'])} - {fmt_time(region['end'])}).",
                  confidence=0.7)
    for region in level_data.get("level_jump_regions", []):
        add_issue("level_jump", "moderate", region["start"], region["end"],
                  f"Sudden level change detected at {fmt_time(region['start'])}.",
                  confidence=0.75)

    # Noise issues
    noise_data = results.get("noise_floor", {}).get("data", {})
    for region in noise_data.get("noisy_regions", []):
        add_issue("high_noise", "mild", region["start"], region["end"],
                  f"Elevated noise floor detected ({fmt_time(region['start'])} - {fmt_time(region['end'])}).",
                  confidence=0.6)

    # Hum issues
    hum_data = results.get("hum", {}).get("data", {})
    detected_hum = hum_data.get("detected_hum")
    if detected_hum:
        freq = detected_hum.get("frequency", 60)
        confidence = detected_hum.get("confidence", 0.5)
        sev = "moderate" if confidence > 0.5 else "mild"
        add_issue("hum", sev, 0, duration,
                  f"Possible {freq} Hz electrical hum detected (confidence: {confidence:.0%}). "
                  f"{detected_hum.get('elevated_harmonics_count', 0)} harmonics also elevated.",
                  center_freq=freq, measured=detected_hum.get("fundamental_ratio"),
                  confidence=confidence)

    # Rumble issues
    rumble_data = results.get("rumble", {}).get("data", {})
    for region in rumble_data.get("rumble_regions", []):
        add_issue("rumble", "mild", region["start"], region["end"],
                  f"Excessive low-frequency energy detected ({fmt_time(region['start'])} - {fmt_time(region['end'])}). "
                  f"Possible handling noise, HVAC, or vibration.",
                  confidence=0.65)

    # Harshness issues
    harsh_data = results.get("harshness_sibilance", {}).get("data", {})
    for region in harsh_data.get("harshness_regions", []):
        add_issue("harshness", "mild", region["start"], region["end"],
                  f"Excessive energy in 2-5 kHz range at {fmt_time(region['start'])}. Possible harshness.",
                  confidence=0.6)
    for region in harsh_data.get("sibilance_regions", []):
        add_issue("sibilance", "mild", region["start"], region["end"],
                  f"Excessive energy in 5-9 kHz range at {fmt_time(region['start'])}. Possible sibilance.",
                  confidence=0.6)

    # Resonance issues
    resonance_data = results.get("resonance", {}).get("data", {})
    for res in resonance_data.get("resonances", [])[:5]:
        if res["strength"] > 5:
            sev = "moderate" if res["strength"] > 10 else "mild"
            add_issue("resonance", sev, 0, duration,
                      f"Spectral resonance at {res['center_frequency_hz']} Hz "
                      f"(bandwidth: {res['bandwidth_hz']} Hz, strength: {res['strength']}x). "
                      f"Possible room or microphone resonance.",
                      center_freq=res["center_frequency_hz"],
                      measured=res["strength"],
                      confidence=min(0.8, res["strength"] / 20))

    # DC offset issue
    dc_data = results.get("dc_offset", {}).get("data", {})
    if dc_data.get("is_significant"):
        add_issue("dc_offset", "mild", 0, duration,
                  f"DC offset detected: {dc_data.get('dc_offset_linear')} ({dc_data.get('dc_offset_db')} dB).",
                  measured=dc_data.get("dc_offset_linear"),
                  confidence=0.9)

    # Phase issues
    phase_data = results.get("phase", {}).get("data", {})
    if phase_data.get("polarity_inverted"):
        add_issue("phase_problem", "significant", 0, duration,
                  "Possible polarity inversion between left and right channels (correlation < -0.8).",
                  measured=phase_data.get("phase_correlation"),
                  confidence=0.9)
    if phase_data.get("imbalance_significant"):
        add_issue("channel_imbalance", "moderate", 0, duration,
                  f"Channel imbalance detected: {phase_data.get('balance_db')} dB between L and R.",
                  measured=phase_data.get("balance_db"),
                  threshold=3.0,
                  confidence=0.85)

    return issues


# ---------------------------------------------------------------------------
# Summary Generation
# ---------------------------------------------------------------------------

def generate_summary(results, duration):
    """Generate a human-readable summary from measured values."""
    parts = []

    loudness = results.get("loudness", {}).get("data", {})
    lufs = loudness.get("integrated_lufs")
    if lufs is not None:
        parts.append(f"The dialogue has an integrated loudness of {lufs} LUFS")

    peak_data = results.get("peaks", {}).get("data", {})
    clip_count = peak_data.get("clipping_count", 0)
    if clip_count > 0:
        parts.append(f"{clip_count} clipping event{'s' if clip_count != 1 else ''} detected")
    else:
        parts.append("no digital clipping detected")

    hum_data = results.get("hum", {}).get("data", {})
    detected_hum = hum_data.get("detected_hum")
    if detected_hum:
        freq = detected_hum.get("frequency", 60)
        conf = detected_hum.get("confidence", 0)
        parts.append(f"possible {freq} Hz electrical hum detected (confidence: {conf:.0%})")

    level_data = results.get("level_consistency", {}).get("data", {})
    low_regions = level_data.get("low_dialogue_regions", [])
    high_regions = level_data.get("high_dialogue_regions", [])
    if low_regions:
        first = low_regions[0]
        parts.append(f"several sections are noticeably quieter than the rest of the track (first at {fmt_time(first['start'])})")
    if high_regions:
        parts.append(f"some sections are louder than average")

    noise_data = results.get("noise_floor", {}).get("data", {})
    noise_floor = noise_data.get("estimated_noise_floor_dbfs")
    if noise_floor is not None:
        parts.append(f"estimated noise floor at {noise_floor} dBFS")

    # Construct final sentence
    if not parts:
        return "Analysis completed. No significant issues detected."

    # Join with semicolons for a professional tone
    summary = "; ".join(parts[:-1])
    if summary:
        summary += "; and " + parts[-1] + "."
    else:
        summary = parts[0] + "." if not parts[0].endswith(".") else parts[0]

    # Add cautious language note
    summary += " All values are based on actual DSP measurements of the uploaded file."

    return summary


# ---------------------------------------------------------------------------
# Main Analysis Entry Point
# ---------------------------------------------------------------------------

def main():
    if len(sys.argv) < 3:
        print("Usage: python3 analyze.py <input_wav> <output_json>", file=sys.stderr)
        sys.exit(1)

    input_path = sys.argv[1]
    output_path = sys.argv[2]

    print(f"[analyze] Starting analysis of: {input_path}")

    # Read the audio file
    try:
        audio, sample_rate = sf.read(input_path, always_2d=True, dtype="float64")
        channels = audio.shape[1]
        duration = len(audio) / sample_rate
        file_size = os.path.getsize(input_path)

        # Get format info
        info = sf.info(input_path)
        format_info = {
            "format": info.format,
            "subtype": info.subtype,
            "bit_depth": None,
        }
        # Determine bit depth from subtype
        subtype = info.subtype.lower()
        if "16" in subtype:
            format_info["bit_depth"] = 16
        elif "24" in subtype:
            format_info["bit_depth"] = 24
        elif "32" in subtype and "float" not in subtype:
            format_info["bit_depth"] = 32
        elif "float" in subtype:
            format_info["bit_depth"] = 32  # 32-bit float
        elif "8" in subtype:
            format_info["bit_depth"] = 8

        print(f"[analyze] File: {duration:.1f}s, {sample_rate} Hz, {channels}ch, {format_info}")
    except Exception as e:
        print(f"[analyze] FATAL: Failed to read audio file: {e}", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        result = {
            "analysis_version": ANALYSIS_VERSION,
            "status": "failed",
            "error": f"Failed to read audio file: {e}",
            "modules": {},
            "issues": [],
            "summary_text": None,
        }
        with open(output_path, "w") as f:
            json.dump(result, f)
        sys.exit(1)

    # Run all analysis modules independently
    results = {}
    print("[analyze] Running module: file_info")
    results["file_info"] = analyze_file_info(audio, sample_rate, channels, duration, file_size, format_info)

    print("[analyze] Running module: loudness")
    results["loudness"] = analyze_loudness(audio, sample_rate, channels, duration)

    print("[analyze] Running module: peaks")
    results["peaks"] = analyze_peaks(audio, sample_rate, channels, duration)

    # Get integrated LUFS for level consistency
    integrated_lufs = results.get("loudness", {}).get("data", {}).get("integrated_lufs")

    print("[analyze] Running module: level_consistency")
    results["level_consistency"] = analyze_level_consistency(audio, sample_rate, channels, duration, integrated_lufs)

    print("[analyze] Running module: noise_floor")
    results["noise_floor"] = analyze_noise_floor(audio, sample_rate, channels, duration)

    print("[analyze] Running module: hum")
    results["hum"] = analyze_hum(audio, sample_rate, channels, duration)

    print("[analyze] Running module: spectrum")
    results["spectrum"] = analyze_spectrum(audio, sample_rate, channels, duration)

    print("[analyze] Running module: rumble")
    results["rumble"] = analyze_rumble(audio, sample_rate, channels, duration)

    print("[analyze] Running module: harshness_sibilance")
    results["harshness_sibilance"] = analyze_harshness_sibilance(audio, sample_rate, channels, duration)

    print("[analyze] Running module: resonance")
    results["resonance"] = analyze_resonance(audio, sample_rate, channels, duration)

    # Get sample peak for dynamics
    sample_peak_linear = results.get("peaks", {}).get("data", {}).get("sample_peak_linear", 0.0)

    print("[analyze] Running module: dynamics")
    results["dynamics"] = analyze_dynamics(audio, sample_rate, channels, duration, sample_peak_linear)

    print("[analyze] Running module: silence")
    results["silence"] = analyze_silence(audio, sample_rate, channels, duration)

    print("[analyze] Running module: dc_offset")
    results["dc_offset"] = analyze_dc_offset(audio, sample_rate, channels, duration)

    print("[analyze] Running module: phase")
    results["phase"] = analyze_phase(audio, sample_rate, channels, duration)

    print("[analyze] Running module: speech")
    results["speech"] = analyze_speech(audio, sample_rate, channels, duration)

    # Generate issues from analysis results
    print("[analyze] Generating issues")
    issues = generate_issues(results, duration)

    # Generate summary
    print("[analyze] Generating summary")
    summary_text = generate_summary(results, duration)

    # Extract structured values for database columns
    loudness_data = results.get("loudness", {}).get("data", {})
    peak_data = results.get("peaks", {}).get("data", {})
    dynamics_data = results.get("dynamics", {}).get("data", {})
    noise_data = results.get("noise_floor", {}).get("data", {})
    dc_data = results.get("dc_offset", {}).get("data", {})
    speech_data = results.get("speech", {}).get("data", {})

    structured = {
        "integrated_lufs": loudness_data.get("integrated_lufs"),
        "loudness_range": loudness_data.get("loudness_range"),
        "true_peak": loudness_data.get("true_peak_dbtp"),
        "sample_peak": peak_data.get("sample_peak_dbfs"),
        "maximum_momentary_loudness": loudness_data.get("maximum_momentary_lufs"),
        "maximum_short_term_loudness": loudness_data.get("maximum_short_term_lufs"),
        "rms_average": loudness_data.get("rms_average_dbfs"),
        "estimated_noise_floor": noise_data.get("estimated_noise_floor_dbfs"),
        "dynamic_range": dynamics_data.get("dynamic_range_db"),
        "crest_factor": dynamics_data.get("crest_factor_db"),
        "dc_offset": dc_data.get("dc_offset_linear"),
        "clipping_count": peak_data.get("clipping_count"),
        "speech_percentage": speech_data.get("speech_percentage"),
    }

    # Build final result
    final_result = {
        "analysis_version": ANALYSIS_VERSION,
        "status": "completed",
        "duration": round(duration, 3),
        "structured": structured,
        "modules": results,
        "issues": issues,
        "summary_text": summary_text,
    }

    # Write JSON output
    with open(output_path, "w") as f:
        json.dump(final_result, f, indent=2, default=str)

    # Count module statuses
    succeeded = sum(1 for v in results.values() if v.get("status") == "success")
    failed = sum(1 for v in results.values() if v.get("status") == "failed")
    skipped = sum(1 for v in results.values() if v.get("status") == "skipped")

    print(f"[analyze] Analysis complete: {succeeded} succeeded, {failed} failed, {skipped} skipped")
    print(f"[analyze] Generated {len(issues)} issues")
    print(f"[analyze] Output written to: {output_path}")


if __name__ == "__main__":
    main()
