-- Stable document IDs let FTS use external content without relying on source rowids.
CREATE TABLE library_documents (
    id INTEGER PRIMARY KEY,
    meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    source_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    audio_start_time REAL,
    UNIQUE(kind, source_id)
);
CREATE INDEX library_documents_meeting ON library_documents(meeting_id);
CREATE VIRTUAL TABLE library_search USING fts5(
    title, body, content='library_documents', content_rowid='id',
    tokenize='porter unicode61'
);
CREATE TRIGGER library_documents_insert AFTER INSERT ON library_documents BEGIN
    INSERT INTO library_search(rowid, title, body) VALUES (new.id, new.title, new.body);
END;
CREATE TRIGGER library_documents_delete AFTER DELETE ON library_documents BEGIN
    INSERT INTO library_search(library_search, rowid, title, body) VALUES ('delete', old.id, old.title, old.body);
END;
CREATE TRIGGER library_documents_update AFTER UPDATE ON library_documents
WHEN old.title IS NOT new.title OR old.body IS NOT new.body BEGIN
    INSERT INTO library_search(library_search, rowid, title, body) VALUES ('delete', old.id, old.title, old.body);
    INSERT INTO library_search(rowid, title, body) VALUES (new.id, new.title, new.body);
END;

INSERT INTO library_documents(meeting_id, source_id, kind, title, body, audio_start_time)
SELECT t.meeting_id, t.id, 'transcript', m.title, t.transcript, t.audio_start_time
FROM transcripts t JOIN meetings m ON m.id = t.meeting_id;
INSERT INTO library_documents(meeting_id, source_id, kind, title, body)
SELECT n.meeting_id, n.meeting_id, 'notes', m.title, COALESCE(n.notes_markdown, '')
FROM meeting_notes n JOIN meetings m ON m.id = n.meeting_id;

CREATE TRIGGER library_transcript_insert AFTER INSERT ON transcripts BEGIN
    INSERT INTO library_documents(meeting_id, source_id, kind, title, body, audio_start_time)
    SELECT new.meeting_id, new.id, 'transcript', title, new.transcript, new.audio_start_time
    FROM meetings WHERE id = new.meeting_id;
END;
CREATE TRIGGER library_transcript_update AFTER UPDATE OF id, meeting_id, transcript, audio_start_time ON transcripts BEGIN
    UPDATE library_documents SET meeting_id = new.meeting_id, source_id = new.id,
        title = (SELECT title FROM meetings WHERE id = new.meeting_id), body = new.transcript,
        audio_start_time = new.audio_start_time WHERE kind = 'transcript' AND source_id = old.id;
END;
CREATE TRIGGER library_transcript_delete AFTER DELETE ON transcripts BEGIN
    DELETE FROM library_documents WHERE kind = 'transcript' AND source_id = old.id;
END;
CREATE TRIGGER library_notes_insert AFTER INSERT ON meeting_notes BEGIN
    INSERT INTO library_documents(meeting_id, source_id, kind, title, body)
    SELECT new.meeting_id, new.meeting_id, 'notes', title, COALESCE(new.notes_markdown, '')
    FROM meetings WHERE id = new.meeting_id;
END;
CREATE TRIGGER library_notes_update AFTER UPDATE OF meeting_id, notes_markdown ON meeting_notes BEGIN
    UPDATE library_documents SET meeting_id = new.meeting_id, source_id = new.meeting_id,
        title = (SELECT title FROM meetings WHERE id = new.meeting_id), body = COALESCE(new.notes_markdown, '')
        WHERE kind = 'notes' AND source_id = old.meeting_id;
END;
CREATE TRIGGER library_notes_delete AFTER DELETE ON meeting_notes BEGIN
    DELETE FROM library_documents WHERE kind = 'notes' AND source_id = old.meeting_id;
END;
CREATE TRIGGER library_meeting_title AFTER UPDATE OF title ON meetings BEGIN
    UPDATE library_documents SET title = new.title WHERE meeting_id = new.id;
END;
