CREATE TABLE library_chats (
    id TEXT PRIMARY KEY NOT NULL,
    title TEXT NOT NULL DEFAULT 'New conversation',
    messages_json TEXT NOT NULL DEFAULT '[]',
    draft TEXT NOT NULL DEFAULT '',
    period TEXT NOT NULL DEFAULT 'all',
    archived INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
);
CREATE INDEX library_chats_activity ON library_chats(archived, updated_at DESC);
CREATE TABLE library_chat_sources (
    chat_id TEXT NOT NULL REFERENCES library_chats(id) ON DELETE CASCADE,
    meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    PRIMARY KEY(chat_id, meeting_id)
);
CREATE INDEX library_chat_sources_meeting ON library_chat_sources(meeting_id);

-- Do not retain copied excerpts or generated answers after their source is deleted.
-- User questions and answers based on other meetings remain available.
CREATE TRIGGER library_chat_source_deleted BEFORE DELETE ON meetings BEGIN
    UPDATE library_chats SET messages_json = (
        SELECT json_group_array(json(CASE WHEN EXISTS (
            SELECT 1 FROM json_each(message.value, '$.sources') AS source
            WHERE json_extract(source.value, '$.meetingId') = old.id
        ) OR EXISTS (
            SELECT 1 FROM json_each(message.value, '$.sourceMeetingIds') AS consulted WHERE consulted.value = old.id
        ) THEN json_object('role', 'assistant', 'content', '',
            'notice', 'A source meeting was deleted. This answer is no longer available.')
        ELSE message.value END)) FROM json_each(messages_json) AS message
    ) WHERE id IN (SELECT chat_id FROM library_chat_sources WHERE meeting_id = old.id);
END;
