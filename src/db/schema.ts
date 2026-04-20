export const SCHEMA = `
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  repo TEXT NOT NULL,
  pr_number INTEGER NOT NULL,
  pr_title TEXT NOT NULL,
  pr_url TEXT NOT NULL,
  pr_author TEXT NOT NULL,
  event_type TEXT NOT NULL,
  source TEXT NOT NULL,
  actor TEXT NOT NULL,
  body TEXT,
  github_url TEXT NOT NULL,
  received_at TEXT NOT NULL,
  notified INTEGER DEFAULT 0,
  reviewed INTEGER DEFAULT 0,
  dispatched_to TEXT,
  dispatched_at TEXT,
  dispatch_status TEXT,
  auto_closed_at TEXT,
  auto_close_reason TEXT
);

CREATE TABLE IF NOT EXISTS watched_repos (
  full_name TEXT PRIMARY KEY,
  active INTEGER DEFAULT 1,
  last_polled TEXT,
  webhook_id INTEGER
);

CREATE TABLE IF NOT EXISTS check_run_triggers (
  id TEXT PRIMARY KEY,
  repo TEXT NOT NULL,
  pr_number INTEGER NOT NULL,
  check_run_id INTEGER NOT NULL,
  check_name TEXT NOT NULL,
  conclusion TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  dispatched INTEGER DEFAULT 0,
  dispatched_at TEXT
);

CREATE TABLE IF NOT EXISTS linked_sessions (
  id TEXT PRIMARY KEY,
  repo TEXT NOT NULL,
  pr_number INTEGER NOT NULL,
  agent_type TEXT NOT NULL,
  terminal_pid INTEGER,
  tty TEXT,
  tmux_pane TEXT,
  repo_path TEXT NOT NULL,
  linked_at TEXT NOT NULL,
  unlinked_at TEXT,
  unlink_reason TEXT,
  sentinel_comment_id INTEGER,
  merged_at TEXT,
  UNIQUE(repo, pr_number)
);

CREATE TABLE IF NOT EXISTS pr_health (
  repo TEXT NOT NULL,
  pr_number INTEGER NOT NULL,
  check_name TEXT NOT NULL,
  last_conclusion TEXT NOT NULL,
  last_run_at TEXT NOT NULL,
  status TEXT,
  PRIMARY KEY (repo, pr_number, check_name)
);

CREATE TABLE IF NOT EXISTS dispatch_log (
  id TEXT PRIMARY KEY,
  event_id TEXT REFERENCES events(id),
  agent TEXT NOT NULL,
  prompt TEXT NOT NULL,
  response TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS webhook_log (
  id TEXT PRIMARY KEY,
  received_at TEXT NOT NULL,
  event_type TEXT NOT NULL,
  action TEXT,
  repo TEXT,
  pr_number INTEGER,
  actor TEXT,
  disposition TEXT NOT NULL,
  reason TEXT,
  delivery_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_webhook_log_received ON webhook_log(received_at DESC);
`
