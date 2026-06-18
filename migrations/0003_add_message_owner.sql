ALTER TABLE messages ADD COLUMN user_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_messages_user_id
ON messages(user_id);
