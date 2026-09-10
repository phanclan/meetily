-- Keep note data and recording paths intact until an explicit permanent deletion.
CREATE TABLE meeting_trash (
    meeting_id TEXT PRIMARY KEY REFERENCES meetings(id) ON DELETE CASCADE,
    trashed_at TEXT NOT NULL
);
CREATE INDEX meeting_trash_recent ON meeting_trash(trashed_at DESC, meeting_id DESC);
