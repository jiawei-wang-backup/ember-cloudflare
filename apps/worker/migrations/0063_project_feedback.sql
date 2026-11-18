CREATE TABLE project_feedback (
  room_id TEXT NOT NULL,
  id TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL,
  last_request_id TEXT NOT NULL,
  record TEXT NOT NULL,
  PRIMARY KEY (room_id, id)
);
CREATE INDEX project_feedback_by_created ON project_feedback(room_id, created_at DESC, id DESC);
CREATE TABLE project_feedback_events (
  room_id TEXT NOT NULL,
  feedback_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  request_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  record TEXT NOT NULL,
  PRIMARY KEY (room_id, request_id)
);
CREATE UNIQUE INDEX project_feedback_events_by_item ON project_feedback_events(room_id, feedback_id, version);
