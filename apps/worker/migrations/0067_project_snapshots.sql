CREATE TABLE IF NOT EXISTS ember_project_snapshots (
  room_id TEXT PRIMARY KEY,
  record TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ember_project_announcements (
  room_id TEXT NOT NULL,
  revision TEXT NOT NULL,
  record TEXT NOT NULL,
  PRIMARY KEY (room_id, revision)
);
