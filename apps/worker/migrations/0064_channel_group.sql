ALTER TABLE rooms ADD COLUMN channel_group TEXT CHECK (channel_group IN ('project','team'));
