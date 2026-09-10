CREATE TABLE note_folders (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    name_key TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
);

CREATE TABLE note_folder_members (
    folder_id TEXT NOT NULL REFERENCES note_folders(id) ON DELETE CASCADE,
    meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    PRIMARY KEY (folder_id, meeting_id)
);
CREATE INDEX note_folder_members_meeting ON note_folder_members(meeting_id);
