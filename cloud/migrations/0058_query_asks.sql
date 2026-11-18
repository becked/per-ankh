-- One row per Explore ask question that reaches the model (POST /v1/query/ask,
-- cloud/src/query/ask-usage.ts). A question answered from the answer cache
-- makes no model call and writes no row.
--
-- Every ask limit reads this table: questions per account in the last 24
-- hours, questions per IP and in total in the last hour, and the calendar
-- month's token spend against the monthly budget. A row per question rather
-- than per call, so the per-account limit counts questions and a retry is not
-- a second one.
--
-- Its own table rather than `events` rows, because the monthly budget sums
-- token counts: `events` keeps them only as JSON in `metadata`, and its one
-- time index (`created_at`) would make every ask scan every event of the month
-- (12,108 rows in the 30 days before the 2026-11-15 snapshot).
--
-- Pruned nightly (QUERY_ASKS_RETENTION, cloud/src/retention.ts). It holds IP
-- addresses, so it keeps only what the longest reader needs.
CREATE TABLE query_asks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    ip_address TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    -- Summed over the question's model calls, as the responses report them.
    -- input_tokens includes cached_input_tokens. Written at worst case before
    -- the first call and replaced with the reported counts after the last, so
    -- a question in flight, or one whose call threw, counts at worst case.
    input_tokens INTEGER NOT NULL,
    cached_input_tokens INTEGER NOT NULL,
    output_tokens INTEGER NOT NULL
);

CREATE INDEX idx_query_asks_created_at ON query_asks(created_at);
CREATE INDEX idx_query_asks_user_created ON query_asks(user_id, created_at);
CREATE INDEX idx_query_asks_ip_created ON query_asks(ip_address, created_at);
