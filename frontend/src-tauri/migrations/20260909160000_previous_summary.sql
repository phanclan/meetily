-- Keep one recoverable version when enhancement successfully replaces a result.
-- Failed/cancelled jobs continue to use the existing in-flight backup.
CREATE TABLE previous_summaries (
    meeting_id TEXT PRIMARY KEY REFERENCES meetings(id) ON DELETE CASCADE,
    version_id TEXT NOT NULL,
    result TEXT NOT NULL,
    saved_at TEXT NOT NULL,
    last_restore_source_version TEXT,
    last_restore_revision TEXT
);

CREATE TRIGGER preserve_previous_summary
BEFORE UPDATE OF result ON summary_processes
WHEN lower(OLD.status) IN ('pending', 'processing')
 AND lower(NEW.status) = 'completed'
 AND OLD.result_backup IS NOT NULL
 AND NEW.result IS NOT OLD.result_backup
BEGIN
    INSERT INTO previous_summaries (meeting_id, version_id, result, saved_at)
    VALUES (OLD.meeting_id, lower(hex(randomblob(16))), OLD.result_backup,
            COALESCE(OLD.result_backup_timestamp, OLD.updated_at))
    ON CONFLICT(meeting_id) DO UPDATE SET
        version_id = excluded.version_id,
        result = excluded.result,
        saved_at = excluded.saved_at,
        last_restore_source_version = NULL,
        last_restore_revision = NULL;
END;
