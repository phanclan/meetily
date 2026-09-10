ALTER TABLE library_chats ADD COLUMN source_scope TEXT NOT NULL DEFAULT 'keywords'
    CHECK (source_scope IN ('keywords', 'recent'));
