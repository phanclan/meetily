-- Support bounded per-meeting search and ordered transcript pagination.
CREATE INDEX IF NOT EXISTS idx_transcripts_meeting_order
    ON transcripts(meeting_id, audio_start_time, id);
