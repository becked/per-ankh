-- security_events: one row per security-relevant request, drained by Skiff
-- (external, read-only triage tooling) over the D1 REST API, cursoring on `id`.
-- Nothing in the app reads this table back — it's append-only plus a nightly
-- age-out sweep (sweepSecurityEvents in cloud/src/retention.ts).
--
-- Lives in its OWN D1 database (binding SECURITY_DB, per-ankh-security-events),
-- NOT the app's SHARE_DB, so write bursts under a probe flood can't contend
-- with live app queries on D1's single-threaded-per-database engine.
--
-- Emit chokepoint + reason vocabulary: cloud/src/security-events.ts.
-- Contract: issue #71.

CREATE TABLE security_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT, -- drain cursor; AUTOINCREMENT so ids are never reused
  ts         TEXT    NOT NULL,                  -- ISO-8601 UTC (event time)
  route      TEXT    NOT NULL,                  -- matched route pattern, e.g. 'GET /v1/admin/games/all'
  status     INTEGER NOT NULL,                  -- response status
  reason     TEXT    NOT NULL,                  -- classification (see security-events.ts)
  actor_ip   TEXT,                              -- CF-Connecting-IP; NULL when the request didn't traverse the edge
  request_id TEXT    NOT NULL,                  -- correlates to the access-log line
  meta       TEXT                               -- small JSON, optional (e.g. truncated raw_path for synthetic patterns)
);

-- The nightly retention sweep deletes by age; index ts so it doesn't full-scan.
CREATE INDEX idx_security_events_ts ON security_events (ts);
