CREATE TABLE IF NOT EXISTS meeting_chat (
    meeting_id TEXT PRIMARY KEY NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    messages_json TEXT NOT NULL
);
