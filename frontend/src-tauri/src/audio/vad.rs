use anyhow::{anyhow, Result};
use silero_rs::{VadConfig, VadSession, VadTransition};
use log::{debug, info, warn};
use std::collections::VecDeque;
use std::time::Duration;

/// Represents a complete speech segment detected by VAD
#[derive(Debug, Clone)]
pub struct SpeechSegment {
    pub samples: Vec<f32>,
    pub start_timestamp_ms: f64,
    pub end_timestamp_ms: f64,
    pub confidence: f32,
}

/// Processes audio in 30ms chunks but returns complete speech segments
pub struct ContinuousVadProcessor {
    session: VadSession,
    chunk_size: usize,
    sample_rate: u32,
    buffer: Vec<f32>,
    speech_segments: VecDeque<SpeechSegment>,
    current_speech: Vec<f32>,
    in_speech: bool,
    processed_samples: usize,
    speech_start_sample: usize,
    // State tracking for smart logging
    last_logged_state: bool,
    /// Maximum in-flight utterance length (16kHz samples) before a segment is
    /// force-emitted without waiting for SpeechEnd. `None` disables the cap.
    max_utterance_samples: Option<usize>,
    /// True when the current utterance has already had audio force-emitted, so the
    /// eventual SpeechEnd must only emit the remainder (never the full utterance).
    forced_emit_in_progress: bool,
}

impl ContinuousVadProcessor {
    pub fn new(input_sample_rate: u32, redemption_time_ms: u32) -> Result<Self> {
        // Silero VAD MUST use 16kHz - this is hardcoded requirement
        const VAD_SAMPLE_RATE: u32 = 16000;

        // Use STRICT settings to prevent silence from reaching Whisper
        let mut config = VadConfig::default();
        config.sample_rate = VAD_SAMPLE_RATE as usize;

        // CONTINUOUS SPEECH FIX: Tuned for capturing complete 5+ second utterances
        // Previous: 0.55/0.40 with 400ms redemption was fragmenting speech into 40ms segments
        // New: More lenient thresholds + longer redemption for continuous speech
        config.positive_speech_threshold = 0.50;  // Silero default - good for continuous speech
        config.negative_speech_threshold = 0.35;  // Silero default - allows natural pauses

        // CRITICAL FIX: Removed redemption_time capping to support long continuous speech
        // Previous: capped at 400ms, causing VAD to fragment 5-second speech into 40ms segments
        // New: Use full redemption_time from pipeline (2000ms) to bridge natural pauses
        config.redemption_time = Duration::from_millis(redemption_time_ms as u64);
        config.pre_speech_pad = Duration::from_millis(300);   // Pre-speech padding for context
        config.post_speech_pad = Duration::from_millis(400);  // Increased: more context at end

        // CRITICAL FIX: Increased min_speech_time to prevent tiny 40ms fragments
        // Previous: 100ms allowed too-short segments that Whisper rejects
        // New: 250ms ensures segments are substantial enough for Whisper (>100ms requirement)
        config.min_speech_time = Duration::from_millis(250);  // Prevent tiny fragments

        debug!("Creating VAD session with: sample_rate={}Hz, redemption={}ms, min_speech={}ms, input_rate={}Hz",
               VAD_SAMPLE_RATE, redemption_time_ms, 250, input_sample_rate);

        let session = VadSession::new(config)
            .map_err(|e| anyhow!("Failed to create VAD session: {:?}", e))?;

        // VAD uses 30ms chunks at 16kHz (480 samples)
        let vad_chunk_size = (VAD_SAMPLE_RATE as f32 * 0.03) as usize; // 480 samples

        info!("VAD processor created: input={}Hz, vad={}Hz, chunk_size={} samples",
              input_sample_rate, VAD_SAMPLE_RATE, vad_chunk_size);

        Ok(Self {
            session,
            chunk_size: vad_chunk_size,
            sample_rate: input_sample_rate, // Store input rate for resampling ratio in resample_to_16k()
            buffer: Vec::with_capacity(vad_chunk_size * 2),
            speech_segments: VecDeque::new(),
            current_speech: Vec::new(),
            in_speech: false,
            processed_samples: 0,
            speech_start_sample: 0,
            // Initialize state tracking
            last_logged_state: false,
            max_utterance_samples: None,
            forced_emit_in_progress: false,
        })
    }

    /// Cap the in-flight utterance length for live (streaming) use.
    ///
    /// Without a cap, a speaker who never pauses long enough for SpeechEnd produces a
    /// single unbounded segment, so nothing reaches the transcript until they stop
    /// talking. With a cap, the accumulated speech is emitted every `max_ms` and the
    /// utterance continues in the next segment.
    ///
    /// Batch/file retranscription intentionally leaves this unset so segmentation there
    /// is still driven purely by VAD transitions.
    pub fn with_max_utterance_ms(mut self, max_ms: u32) -> Self {
        // processed_samples / current_speech always count 16kHz samples (post-resampling)
        let samples = (max_ms as usize * 16000) / 1000;
        info!("VAD: live utterance cap set to {}ms ({} samples)", max_ms, samples);
        self.max_utterance_samples = Some(samples);
        self
    }

    /// Process incoming audio samples and return any complete speech segments
    /// Handles resampling from input sample rate to 16kHz for VAD processing
    pub fn process_audio(&mut self, samples: &[f32]) -> Result<Vec<SpeechSegment>> {
        // Resample to 16kHz if needed
        let resampled_audio = if self.sample_rate == 16000 {
            samples.to_vec()
        } else {
            self.resample_to_16k(samples)?
        };

        self.buffer.extend_from_slice(&resampled_audio);
        let mut completed_segments = Vec::new();

        // Process complete 30ms chunks (480 samples at 16kHz)
        while self.buffer.len() >= self.chunk_size {
            let chunk: Vec<f32> = self.buffer.drain(..self.chunk_size).collect();
            self.process_chunk(&chunk)?;

            // Extract any completed speech segments
            while let Some(segment) = self.speech_segments.pop_front() {
                completed_segments.push(segment);
            }
        }

        Ok(completed_segments)
    }

    /// Improved resampling from input sample rate to 16kHz with anti-aliasing
    /// Uses linear interpolation and basic low-pass filtering for better quality
    fn resample_to_16k(&self, samples: &[f32]) -> Result<Vec<f32>> {
        if self.sample_rate == 16000 {
            return Ok(samples.to_vec());
        }

        // Calculate downsampling ratio
        let ratio = self.sample_rate as f64 / 16000.0;
        let output_len = (samples.len() as f64 / ratio) as usize;
        let mut resampled = Vec::with_capacity(output_len);

        // Apply simple low-pass filter before downsampling to reduce aliasing
        let cutoff_freq = 0.4; // Normalized frequency (0.4 * Nyquist)
        let mut filtered_samples = Vec::with_capacity(samples.len());
        
        // Simple moving average filter (basic low-pass)
        let filter_size = (self.sample_rate as f64 / (cutoff_freq * self.sample_rate as f64)) as usize;
        let filter_size = std::cmp::max(1, std::cmp::min(filter_size, 5)); // Limit filter size
        
        for i in 0..samples.len() {
            let start = if i >= filter_size { i - filter_size } else { 0 };
            let end = std::cmp::min(i + filter_size + 1, samples.len());
            let sum: f32 = samples[start..end].iter().sum();
            filtered_samples.push(sum / (end - start) as f32);
        }

        // Linear interpolation downsampling
        for i in 0..output_len {
            let source_pos = i as f64 * ratio;
            let source_index = source_pos as usize;
            let fraction = source_pos - source_index as f64;
            
            if source_index + 1 < filtered_samples.len() {
                // Linear interpolation
                let sample1 = filtered_samples[source_index];
                let sample2 = filtered_samples[source_index + 1];
                let interpolated = sample1 + (sample2 - sample1) * fraction as f32;
                resampled.push(interpolated);
            } else if source_index < filtered_samples.len() {
                resampled.push(filtered_samples[source_index]);
            }
        }

        debug!("Resampled from {} samples ({}Hz) to {} samples (16kHz) with anti-aliasing",
               samples.len(), self.sample_rate, resampled.len());

        Ok(resampled)
    }

    /// Flush any remaining audio and return final speech segments
    pub fn flush(&mut self) -> Result<Vec<SpeechSegment>> {
        debug!("VAD flush: in_speech={}, current_speech_len={}, buffer_len={}, speech_segments_queued={}",
              self.in_speech, self.current_speech.len(), self.buffer.len(), self.speech_segments.len());

        let mut completed_segments = Vec::new();

        // Process any remaining buffered audio
        if !self.buffer.is_empty() {
            let remaining = self.buffer.clone();
            self.buffer.clear();

            // Pad to chunk size if needed
            let mut padded_chunk = remaining;
            if padded_chunk.len() < self.chunk_size {
                padded_chunk.resize(self.chunk_size, 0.0);
            }

            self.process_chunk(&padded_chunk)?;
        }

        // Force end any ongoing speech
        if self.in_speech && !self.current_speech.is_empty() {
            // processed_samples and speech_start_sample always count 16kHz samples (post-resampling)
            let start_ms = (self.speech_start_sample as f64 / 16000.0) * 1000.0;
            let end_ms = (self.processed_samples as f64 / 16000.0) * 1000.0;

            debug!("VAD flush: Force-ending speech - start={}ms, end={}ms, duration={}ms, samples={}",
                  start_ms, end_ms, end_ms - start_ms, self.current_speech.len());

            let segment = SpeechSegment {
                samples: self.current_speech.clone(),
                start_timestamp_ms: start_ms,
                end_timestamp_ms: end_ms,
                confidence: 0.8, // Estimated confidence for forced end
            };

            self.speech_segments.push_back(segment);
            self.current_speech.clear();
            self.in_speech = false;
            self.forced_emit_in_progress = false;
        }

        // Extract all remaining segments
        while let Some(segment) = self.speech_segments.pop_front() {
            completed_segments.push(segment);
        }

        Ok(completed_segments)
    }

    fn process_chunk(&mut self, chunk: &[f32]) -> Result<()> {
        // Track accumulated speech buffer size to detect memory issues
        let current_speech_size = self.current_speech.len();
        if current_speech_size > 1_000_000 {
            // More than ~62 seconds of accumulated speech at 16kHz
            warn!("VAD: Accumulated speech buffer is large: {} samples ({:.1}s) - possible memory issue",
                  current_speech_size, current_speech_size as f64 / 16000.0);
        }

        let transitions = self.session.process(chunk)
            .map_err(|e| anyhow!("VAD processing failed: {}", e))?;

        // Log transitions for debugging
        if !transitions.is_empty() {
            debug!("VAD transitions at sample {}: {} transitions", self.processed_samples, transitions.len());
        }

        // True once SpeechStart has seeded `current_speech` from the VAD's own buffer on this
        // chunk. That seed already contains `chunk`, so the accumulate step below must skip it.
        let mut seeded_current_speech = false;

        // Handle VAD transitions
        for transition in transitions {
            match transition {
                VadTransition::SpeechStart { timestamp_ms } => {
                    // Only log if state changed
                    if !self.last_logged_state {
                        debug!("VAD: Speech started at {}ms", timestamp_ms);
                        self.last_logged_state = true;
                    }
                    self.in_speech = true;
                    // `timestamp_ms` is already a stream-absolute position: Silero derives it
                    // from its own processed duration (minus pre-speech padding), and the same
                    // value comes back as `start_timestamp_ms` on SpeechEnd. Adding our
                    // `processed_samples` on top double-counted the stream position, so
                    // cap-forced segments ended up with start > end. Convert ms -> 16kHz samples
                    // only; `processed_samples` counts the same 16kHz stream.
                    self.speech_start_sample = (timestamp_ms * 16000) / 1000;
                    // Silero only reports SpeechStart after `min_speech_time` has elapsed, and it
                    // backdates the utterance by `pre_speech_pad` on top of that. Its buffer
                    // therefore already holds ~600ms of audio that precedes this transition. Seed
                    // `current_speech` with it so a force-emitted (capped) segment carries the
                    // opening words instead of starting ~600ms late. On the normal SpeechEnd path
                    // this is unused - Silero's own `samples` win there.
                    let preroll = self.session.get_current_speech().to_vec();
                    debug!("VAD: Seeded utterance with {} pre-roll samples ({:.0}ms)",
                           preroll.len(), preroll.len() as f64 / 16.0);
                    self.current_speech = preroll;
                    seeded_current_speech = true;
                    self.forced_emit_in_progress = false;
                }
                VadTransition::SpeechEnd { start_timestamp_ms, end_timestamp_ms, samples } => {
                    // Only log if we were previously in speech state
                    if self.last_logged_state {
                        debug!("VAD: Speech ended at {}ms (duration: {}ms)", end_timestamp_ms, end_timestamp_ms - start_timestamp_ms);
                        self.last_logged_state = false;
                    }
                    self.in_speech = false;

                    // Use samples from VAD transition if available, otherwise use accumulated
                    // samples. When part of this utterance was already force-emitted, the VAD's
                    // samples cover the whole utterance, so only the remainder may be sent.
                    let (speech_samples, segment_start_ms) = if self.forced_emit_in_progress {
                        let start_ms = (self.speech_start_sample as f64 / 16000.0) * 1000.0;
                        (std::mem::take(&mut self.current_speech), start_ms)
                    } else if !samples.is_empty() {
                        (samples, start_timestamp_ms as f64)
                    } else {
                        (self.current_speech.clone(), start_timestamp_ms as f64)
                    };

                    if !speech_samples.is_empty() {
                        let segment = SpeechSegment {
                            samples: speech_samples,
                            start_timestamp_ms: segment_start_ms,
                            end_timestamp_ms: end_timestamp_ms as f64,
                            confidence: 0.9, // VAD confidence
                        };

                        info!("VAD: Completed speech segment: {:.1}ms duration, {} samples",
                              segment.end_timestamp_ms - segment.start_timestamp_ms, segment.samples.len());

                        self.speech_segments.push_back(segment);
                    }

                    self.current_speech.clear();
                    self.forced_emit_in_progress = false;
                }
            }
        }

        // Accumulate speech if we're currently in a speech state. When SpeechStart seeded
        // `current_speech` on this chunk the seed already covers `chunk`, so appending again
        // would duplicate it.
        if self.in_speech && !seeded_current_speech {
            self.current_speech.extend_from_slice(chunk);
        }

        self.processed_samples += chunk.len();

        // Force-emit the in-flight utterance once it exceeds the live cap. Without this,
        // continuous speech produces no transcript at all until the speaker pauses.
        //
        // Invariant: `current_speech` spans exactly [speech_start_sample, processed_samples),
        // because SpeechStart seeds it from the VAD buffer at `speech_start_sample` and every
        // later chunk is appended. So the emitted duration always matches the emitted audio.
        if let Some(max_samples) = self.max_utterance_samples {
            if self.in_speech && self.current_speech.len() >= max_samples {
                let start_ms = (self.speech_start_sample as f64 / 16000.0) * 1000.0;
                let end_ms = (self.processed_samples as f64 / 16000.0) * 1000.0;

                let samples = std::mem::take(&mut self.current_speech);
                info!(
                    "VAD: Utterance cap reached - emitting partial segment: {:.1}ms duration, {} samples",
                    end_ms - start_ms,
                    samples.len()
                );

                self.speech_segments.push_back(SpeechSegment {
                    samples,
                    start_timestamp_ms: start_ms,
                    end_timestamp_ms: end_ms,
                    confidence: 0.8, // Estimated confidence for a cap-forced segment
                });

                // The utterance continues; the next segment starts here.
                self.speech_start_sample = self.processed_samples;
                self.forced_emit_in_progress = true;
            }
        }

        Ok(())
    }
}

/// Legacy function for backward compatibility - now uses the optimized approach
pub fn extract_speech_16k(samples_mono_16k: &[f32]) -> Result<Vec<f32>> {
    let mut processor = ContinuousVadProcessor::new(16000, 400)?;

    // Process all audio
    let mut all_segments = processor.process_audio(samples_mono_16k)?;
    let final_segments = processor.flush()?;
    all_segments.extend(final_segments);

    // Concatenate all speech segments
    let mut result = Vec::new();
    let num_segments = all_segments.len();
    for segment in &all_segments {
        result.extend_from_slice(&segment.samples);
    }

    // Apply balanced energy filtering for very short segments
    if result.len() < 1600 { // Less than 100ms at 16kHz
        let input_energy: f32 = samples_mono_16k.iter().map(|&x| x * x).sum::<f32>() / samples_mono_16k.len() as f32;
        let rms = input_energy.sqrt();
        let peak = samples_mono_16k.iter().map(|&x| x.abs()).fold(0.0f32, f32::max);

        // BALANCED FIX: Lowered thresholds to preserve quiet speech while still filtering silence
        // Previous aggressive values (0.08/0.15) were discarding valid quiet speech
        // New values (0.03/0.08) are more balanced - catch quiet speech, reject pure silence
        if rms < 0.2 || peak < 0.20 {
            info!("-----VAD detected silence/noise (RMS: {:.6}, Peak: {:.6}), skipping to prevent hallucinations-----", rms, peak);
            return Ok(Vec::new());
        } else {
            info!("VAD detected speech with sufficient energy (RMS: {:.6}, Peak: {:.6})", rms, peak);
            return Ok(samples_mono_16k.to_vec());
        }
    }

    debug!("VAD: Processed {} samples, extracted {} speech samples from {} segments",
           samples_mono_16k.len(), result.len(), num_segments);

    Ok(result)
}

/// Simple convenience function to get speech chunks from audio
/// Uses the optimized ContinuousVadProcessor with configurable redemption time
pub fn get_speech_chunks(samples_mono_16k: &[f32], redemption_time_ms: u32) -> Result<Vec<SpeechSegment>> {
    get_speech_chunks_with_progress(samples_mono_16k, redemption_time_ms, |_, _| true)
}

/// Get speech chunks with progress callback and cancellation support
/// The callback receives (progress_percent, segments_found) and returns false to cancel
pub fn get_speech_chunks_with_progress<F>(
    samples_mono_16k: &[f32],
    redemption_time_ms: u32,
    mut progress_callback: F,
) -> Result<Vec<SpeechSegment>>
where
    F: FnMut(u32, usize) -> bool,
{
    let mut processor = ContinuousVadProcessor::new(16000, redemption_time_ms)?;

    let total_samples = samples_mono_16k.len();

    // For large files (>1 minute at 16kHz = 960,000 samples), process in chunks with progress logging
    const LARGE_FILE_THRESHOLD: usize = 960_000;
    const CHUNK_SIZE: usize = 160_000; // 10 seconds at 16kHz

    let mut all_segments = Vec::new();

    if total_samples > LARGE_FILE_THRESHOLD {
        info!("VAD: Processing large file ({} samples = {:.1}s), will log progress...",
              total_samples, total_samples as f64 / 16000.0);

        let mut processed = 0;
        let mut last_progress = 0u32;
        let mut chunk_count = 0;
        let total_chunks = (total_samples + CHUNK_SIZE - 1) / CHUNK_SIZE;

        for chunk in samples_mono_16k.chunks(CHUNK_SIZE) {
            chunk_count += 1;

            let start_time = std::time::Instant::now();
            let segments = processor.process_audio(chunk)?;
            let elapsed = start_time.elapsed();

            // Debug log for chunk processing details
            debug!("VAD: Chunk {}/{} processed in {:?}, found {} segments",
                  chunk_count, total_chunks, elapsed, segments.len());

            // Warn if chunk processing took too long (>1 second)
            if elapsed.as_secs() > 1 {
                warn!("VAD: Chunk {} took {:?} - possible performance issue", chunk_count, elapsed);
            }

            all_segments.extend(segments);

            processed += chunk.len();
            let progress = ((processed * 100) / total_samples) as u32;

            // Call progress callback every 5%
            if progress >= last_progress + 5 {
                debug!("VAD: Progress {}% ({} segments found so far)", progress, all_segments.len());

                // Check for cancellation
                if !progress_callback(progress, all_segments.len()) {
                    info!("VAD: Cancelled by callback at {}%", progress);
                    return Err(anyhow!("VAD processing cancelled"));
                }

                last_progress = progress;
            }
        }

        let final_segments = processor.flush()?;
        all_segments.extend(final_segments);

        info!("VAD: Complete! Found {} speech segments", all_segments.len());
    } else {
        // Small file - process all at once
        all_segments = processor.process_audio(samples_mono_16k)?;
        let final_segments = processor.flush()?;
        all_segments.extend(final_segments);
    }

    Ok(all_segments)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Generate synthetic speech-like audio with alternating speech/silence
    fn generate_test_audio_with_speech(duration_seconds: f32, sample_rate: u32) -> Vec<f32> {
        let total_samples = (duration_seconds * sample_rate as f32) as usize;
        let mut samples = vec![0.0f32; total_samples];

        // Create speech-like patterns: bursts of sine waves with varying amplitude
        // Speech every 10 seconds for 5 seconds
        let speech_interval = 10.0; // seconds between speech starts
        let speech_duration = 5.0;  // seconds of speech

        for i in 0..total_samples {
            let time = i as f32 / sample_rate as f32;
            let cycle_time = time % speech_interval;

            // Speech occurs in the first `speech_duration` seconds of each cycle
            if cycle_time < speech_duration {
                // Generate speech-like signal: multiple frequencies with amplitude modulation
                let freq1 = 200.0 + (time * 50.0).sin() * 100.0; // Varying fundamental
                let freq2 = freq1 * 2.0; // Harmonic
                let freq3 = freq1 * 3.0; // Another harmonic

                let amplitude = 0.3 + 0.1 * (time * 5.0).sin(); // Amplitude modulation
                samples[i] = amplitude * (
                    0.5 * (2.0 * std::f32::consts::PI * freq1 * time).sin() +
                    0.3 * (2.0 * std::f32::consts::PI * freq2 * time).sin() +
                    0.2 * (2.0 * std::f32::consts::PI * freq3 * time).sin()
                );
            }
            // else: silence (already 0.0)
        }

        samples
    }

    #[test]
    fn test_vad_chunked_vs_single_processing() {
        // Generate 60 seconds of audio with speech patterns at 16kHz
        let audio = generate_test_audio_with_speech(60.0, 16000);
        println!("Generated {} samples ({:.1}s)", audio.len(), audio.len() as f32 / 16000.0);

        // Process all at once (like small files)
        let segments_single = get_speech_chunks(&audio, 2000).expect("Single processing failed");
        println!("Single processing found {} segments", segments_single.len());

        // Process in chunks (like large files)
        let segments_chunked = get_speech_chunks_with_progress(&audio, 2000, |progress, segments| {
            println!("Chunked progress: {}%, {} segments", progress, segments);
            true // Don't cancel
        }).expect("Chunked processing failed");
        println!("Chunked processing found {} segments", segments_chunked.len());

        // Both should find the same number of segments (approximately)
        // Allow some variance due to chunk boundary effects
        let diff = (segments_single.len() as i32 - segments_chunked.len() as i32).abs();
        assert!(diff <= 1,
            "Chunked and single processing found different segment counts: {} vs {} (diff: {})",
            segments_single.len(), segments_chunked.len(), diff);
    }

    #[test]
    fn test_vad_large_file_progress() {
        // Generate 120 seconds (2 minutes) of audio - triggers large file threshold
        let audio = generate_test_audio_with_speech(120.0, 16000);
        let total_samples = audio.len();
        println!("Generated {} samples ({:.1}s)", total_samples, total_samples as f32 / 16000.0);

        // This should trigger the large file path (>960,000 samples)
        assert!(total_samples > 960_000, "Audio should be large enough to trigger chunked processing");

        let mut progress_updates = Vec::new();
        let segments = get_speech_chunks_with_progress(&audio, 2000, |progress, segments| {
            progress_updates.push((progress, segments));
            true // Don't cancel
        }).expect("Processing failed");

        println!("Found {} segments with {} progress updates", segments.len(), progress_updates.len());

        // The synthetic signal is not real speech, so Silero may merge it into
        // one long segment. This test is specifically for the large-file path:
        // it must still emit speech and report monotonic progress through 100%.
        assert!(!segments.is_empty(), "Expected at least one speech segment");
        assert!(
            segments.iter().all(|segment| !segment.samples.is_empty()
                && segment.end_timestamp_ms > segment.start_timestamp_ms),
            "Expected all speech segments to contain audio with positive duration"
        );

        // Should have received progress updates
        assert!(!progress_updates.is_empty(), "Expected progress updates for large file");
        assert_eq!(
            progress_updates.last().map(|(progress, _)| *progress),
            Some(100),
            "Expected progress to reach 100%"
        );
        assert!(
            progress_updates
                .windows(2)
                .all(|pair| pair[0].0 < pair[1].0),
            "Expected progress updates to increase monotonically: {:?}",
            progress_updates
        );
    }

    #[test]
    fn test_vad_cancellation() {
        let audio = generate_test_audio_with_speech(120.0, 16000);

        // Cancel at 50%
        let result = get_speech_chunks_with_progress(&audio, 2000, |progress, _| {
            progress < 50 // Cancel when reaching 50%
        });

        // Should return error due to cancellation
        assert!(result.is_err(), "Expected cancellation error");
        let err_msg = result.unwrap_err().to_string();
        assert!(err_msg.contains("cancelled"), "Error should mention cancellation: {}", err_msg);
    }

    #[test]
    fn test_vad_continuous_processor_state_across_chunks() {
        // Test that VAD state is correctly maintained across chunk boundaries
        let mut processor = ContinuousVadProcessor::new(16000, 2000).expect("Failed to create processor");

        // Generate audio with a speech segment that spans a chunk boundary
        let chunk_size = 160_000; // 10 seconds
        let audio = generate_test_audio_with_speech(30.0, 16000); // 30 seconds

        // Process in 10-second chunks
        let mut all_segments = Vec::new();
        for (i, chunk) in audio.chunks(chunk_size).enumerate() {
            let segments = processor.process_audio(chunk).expect("Processing failed");
            println!("Chunk {}: processed {} samples, found {} segments", i, chunk.len(), segments.len());
            all_segments.extend(segments);
        }

        // Flush remaining
        let final_segments = processor.flush().expect("Flush failed");
        all_segments.extend(final_segments);

        println!("Total segments found: {}", all_segments.len());

        // Should find speech segments
        assert!(all_segments.len() >= 1, "Expected at least 1 speech segment");
    }

    /// Minimal PCM16 WAV reader so the cap test can run against real speech without
    /// pulling in an audio-decoding dependency. Walks RIFF chunks (jfk.wav carries a
    /// LIST/INFO chunk before `data`) and asserts the format this module requires.
    fn read_wav_pcm16_mono_16k(path: &std::path::Path) -> Vec<f32> {
        let bytes = std::fs::read(path)
            .unwrap_or_else(|e| panic!("failed to read {}: {}", path.display(), e));
        assert!(bytes.len() > 44, "{} is too small to be a WAV file", path.display());
        assert_eq!(&bytes[0..4], b"RIFF", "{} is not a RIFF file", path.display());
        assert_eq!(&bytes[8..12], b"WAVE", "{} is not a WAVE file", path.display());

        let u16_at = |i: usize| u16::from_le_bytes([bytes[i], bytes[i + 1]]);
        let u32_at = |i: usize| {
            u32::from_le_bytes([bytes[i], bytes[i + 1], bytes[i + 2], bytes[i + 3]]) as usize
        };

        let mut pos = 12;
        let mut data: Option<(usize, usize)> = None;
        let mut fmt_checked = false;

        while pos + 8 <= bytes.len() {
            let id = &bytes[pos..pos + 4];
            let size = u32_at(pos + 4);
            let body = pos + 8;

            if id == b"fmt " {
                assert_eq!(u16_at(body), 1, "expected uncompressed PCM in {}", path.display());
                assert_eq!(u16_at(body + 2), 1, "expected mono audio in {}", path.display());
                assert_eq!(u32_at(body + 4), 16000, "expected 16kHz audio in {}", path.display());
                assert_eq!(u16_at(body + 14), 16, "expected 16-bit samples in {}", path.display());
                fmt_checked = true;
            } else if id == b"data" {
                data = Some((body, size.min(bytes.len() - body)));
                break;
            }

            // RIFF chunks are word-aligned.
            pos = body + size + (size % 2);
        }

        assert!(fmt_checked, "no fmt chunk found in {}", path.display());
        let (offset, size) = data.unwrap_or_else(|| panic!("no data chunk in {}", path.display()));

        bytes[offset..offset + size]
            .chunks_exact(2)
            .map(|pair| i16::from_le_bytes([pair[0], pair[1]]) as f32 / 32768.0)
            .collect()
    }

    /// Real 16kHz mono speech (~11s of JFK's inaugural address) shipped in the repo.
    fn jfk_speech() -> Vec<f32> {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../backend/whisper.cpp/samples/jfk.wav");
        read_wav_pcm16_mono_16k(&path)
    }

    fn run_vad(processor: &mut ContinuousVadProcessor, audio: &[f32]) -> Vec<SpeechSegment> {
        let mut segments = processor.process_audio(audio).expect("VAD processing failed");
        segments.extend(processor.flush().expect("VAD flush failed"));
        segments
    }

    fn total_samples(segments: &[SpeechSegment]) -> usize {
        segments.iter().map(|segment| segment.samples.len()).sum()
    }

    #[test]
    fn test_live_utterance_cap_emits_during_long_speech() {
        // Real speech, not a synthetic tone: Silero does not classify a steady tone as
        // sustained speech, so a synthetic fixture never lets the cap fire at all.
        // Three back-to-back copies of jfk.wav gives ~33s containing utterances longer
        // than the cap used here.
        const CAP_MS: u32 = 1500;
        const LIVE_REDEMPTION_MS: u32 = 400; // matches AudioPipelineManager's live setting

        let clip = jfk_speech();
        assert!(
            clip.len() > 16000 * 5,
            "jfk.wav fixture looks wrong: {} samples",
            clip.len()
        );
        let audio: Vec<f32> = clip.iter().chain(&clip).chain(&clip).copied().collect();

        let mut uncapped_processor =
            ContinuousVadProcessor::new(16000, LIVE_REDEMPTION_MS).expect("processor");
        let uncapped = run_vad(&mut uncapped_processor, &audio);

        let mut capped_processor = ContinuousVadProcessor::new(16000, LIVE_REDEMPTION_MS)
            .expect("processor")
            .with_max_utterance_ms(CAP_MS);
        let capped = run_vad(&mut capped_processor, &audio);

        println!(
            "uncapped: {} segments / {} samples, capped: {} segments / {} samples",
            uncapped.len(),
            total_samples(&uncapped),
            capped.len(),
            total_samples(&capped)
        );

        // 1. The cap must actually fire, repeatedly, while speech is still ongoing.
        // Force-emitted segments carry confidence 0.8 and a duration bounded by the cap
        // (the check runs once per 30ms chunk, so allow one chunk of overshoot).
        let forced: Vec<&SpeechSegment> = capped
            .iter()
            .filter(|segment| {
                let duration = segment.end_timestamp_ms - segment.start_timestamp_ms;
                segment.confidence == 0.8
                    && duration >= CAP_MS as f64
                    && duration < CAP_MS as f64 + 30.0
            })
            .collect();
        assert!(
            forced.len() >= 3,
            "Expected the cap to force-emit several mid-utterance segments, got {} (of {} total)",
            forced.len(),
            capped.len()
        );
        assert!(
            capped.len() > uncapped.len(),
            "Capping should split long utterances into more segments ({} vs {})",
            capped.len(),
            uncapped.len()
        );

        // 2. No segment may claim a start after its end. Before the fix, SpeechStart added
        // the stream position to Silero's already-absolute timestamp, so every cap-forced
        // segment after the first reported start > end.
        for (i, segment) in uncapped.iter().chain(capped.iter()).enumerate() {
            assert!(
                segment.start_timestamp_ms <= segment.end_timestamp_ms,
                "segment {} has start {:.0}ms after end {:.0}ms",
                i,
                segment.start_timestamp_ms,
                segment.end_timestamp_ms
            );
        }

        // 3. No onset loss. A force-emitted segment must carry every sample between the
        // start and end it reports. Before the fix, `current_speech` only began filling at
        // the SpeechStart transition, which Silero raises ~600ms into the utterance, so the
        // opening words were dropped. Tolerance is one millisecond (16 samples) to absorb
        // the ms-granularity of Silero's timestamps.
        for (i, segment) in capped.iter().filter(|s| s.confidence == 0.8).enumerate() {
            let expected =
                (segment.end_timestamp_ms - segment.start_timestamp_ms) * 16000.0 / 1000.0;
            assert!(
                (segment.samples.len() as f64 - expected).abs() <= 16.0,
                "force-emitted segment {} carries {} samples but reports {:.0} ({:.0}ms); \
                 missing audio at the utterance onset",
                i,
                segment.samples.len(),
                expected,
                segment.end_timestamp_ms - segment.start_timestamp_ms
            );
        }

        // 4. Capping must not lose audio overall. Tolerance is 8000 samples (0.5s) across
        // the whole 33s fixture: generous enough for VAD padding differences at segment
        // boundaries, but well under the ~9280 samples (~580ms) a single regressed onset
        // would cost, so one dropped onset still fails this assertion.
        const LOSS_TOLERANCE_SAMPLES: i64 = 8_000;
        let delta = total_samples(&capped) as i64 - total_samples(&uncapped) as i64;
        assert!(
            delta >= -LOSS_TOLERANCE_SAMPLES,
            "Capping dropped {} samples ({:.2}s) of speech versus the uncapped run",
            -delta,
            -delta as f64 / 16000.0
        );

        // 5. Every segment must carry audio.
        assert!(
            capped.iter().all(|segment| !segment.samples.is_empty()),
            "Every capped segment must carry audio"
        );
    }

    #[test]
    fn test_batch_path_leaves_utterance_cap_disabled() {
        // Retranscription segmentation must stay driven purely by VAD transitions.
        let processor = ContinuousVadProcessor::new(16000, 2000).expect("processor");
        assert!(
            processor.max_utterance_samples.is_none(),
            "The utterance cap must be opt-in; batch processing relies on it staying off"
        );
    }

    #[test]
    fn test_vad_400ms_vs_2000ms_segmentation() {
        // Demonstrates why 2000ms redemption is needed for batch processing:
        // 400ms creates excessive fragmentation, 2000ms bridges natural pauses.
        //
        // Audio pattern: 60s with 5s speech / 5s silence cycles
        // Natural pauses within speech (sentence gaps) are 500ms-1.5s
        let audio = generate_test_audio_with_speech(60.0, 16000);

        let segments_400 = get_speech_chunks(&audio, 400).expect("400ms processing failed");
        let segments_2000 = get_speech_chunks(&audio, 2000).expect("2000ms processing failed");

        println!(
            "400ms redemption: {} segments, 2000ms redemption: {} segments",
            segments_400.len(),
            segments_2000.len()
        );

        // 2000ms should produce fewer or equal segments (bridges more pauses)
        assert!(
            segments_2000.len() <= segments_400.len(),
            "2000ms redemption ({} segments) should not produce more segments than 400ms ({} segments)",
            segments_2000.len(),
            segments_400.len()
        );

        // Verify segments have reasonable durations with 2000ms
        for (i, seg) in segments_2000.iter().enumerate() {
            let duration_ms = seg.end_timestamp_ms - seg.start_timestamp_ms;
            println!("2000ms segment {}: {:.0}ms duration", i, duration_ms);
            // Each segment should be at least 250ms (min_speech_time)
            assert!(duration_ms >= 200.0, "Segment {} too short: {:.0}ms", i, duration_ms);
        }
    }
}

