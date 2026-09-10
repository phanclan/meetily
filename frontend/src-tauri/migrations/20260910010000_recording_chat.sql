-- Keep the identity mapping after promotion, with no duplicate conversation text.
-- It also prevents late recording writes from recreating a deleted meeting's chat.
CREATE TABLE recording_chat (
    recording_id TEXT PRIMARY KEY NOT NULL,
    meeting_id TEXT,
    messages_json TEXT,
    CHECK ((meeting_id IS NULL AND messages_json IS NOT NULL)
        OR (meeting_id IS NOT NULL AND messages_json IS NULL))
);
