# Explore

Explore is the `/stats/explore` page. It has two panels on the left. The "Query" panel is a builder: you choose what to count and how to split it, and the server turns that into one SQL query over the public games. The "Question" panel above it takes a question in plain English, and an AI model turns it into a builder query.

## Query builder

### What the user sees

- **Source:** what you're asking about. There are 10, in 6 groups:
  - Games and players: Games, Players.
  - Leaders and families: Family cities, Leaders.
  - Techs and laws: Laws adopted, Techs researched.
  - Turn by turn: Per-turn series.
  - Units: Units produced.
  - Wonders: Wonders available, Wonders built.
- **Measure:** the number to compute, such as Matches, Matches won, Average final points or Earliest turn researched.
- **Groupings:** up to 3 ways to split the rows, such as Nation, Map size or Player.
- **Filters:** up to 8 rows, each with up to 20 values. The operators are "is", "is not", "at least" and "at most".
  - When the app has a list of values (nations, techs, laws, wonders, players, tournaments), you search a picker that shows icons. Otherwise you type the value.
  - The date filter is a dropdown: All time, Last 12 months or Last 6 months.
- **Sort and rows:** Highest first, Lowest first, or By name (only offered when there's a grouping). Row counts are 10, 25, 50, 100 or 200, with 50 as the default.
- A new query starts with two filters already set: Human is Yes, and Played in the last 6 months. You can remove either one.
- Switching source drops any grouping or filter the new source can't use.
- Nothing runs until you press Ask. Ask stays disabled until something has changed and every filter row is filled in.
- Reset clears the URL and returns to the starting form.

### The URL is the query

- Ask writes the query into the URL, for example `?source=player_summaries&dim=nation&measure=wins&f=is_human:in:1`.
- The URL is always written the same way: fixed parameter order, sorted filters and values, defaults left out. So one question always has one URL.
- Because of that, a link shares the exact question, the back button steps through earlier questions, and the edge cache can reuse answers.
- When the URL holds a query, the page reads it and calls `GET /v1/query`. With no query in the URL, nothing runs.

### What the server does

- `GET /v1/query/catalog` returns the list of sources, groupings, measures and filters, plus the player and tournament lists. It doesn't require sign-in and is cached at the edge for 5 minutes.
- `GET /v1/query` requires sign-in.
- It checks the URL strictly. An unknown name, a repeated filter, or two values on an "at least" filter gets a 400 that names the problem. The page shows that message, and the builder keeps working.
- A row count over 200 is lowered to 200 instead of being refused.
- It builds one SQL statement. All the SQL text comes from the server's own list of allowed names. Every value from the user is passed as a bound `?`, so user input never becomes SQL.
- Every query is a grouped total with a row limit. It can't return raw rows.
- Only public games are included, and challenge runs are left out.
- A match uploaded by both players is counted once. Averages and sums read only one upload per match.
- Grouping by Player leaves out seats that don't belong to any account.
- "Is not" also leaves out rows where the value is missing.
- Answers are cached at the edge for 60 seconds.

### Results

- Each group gets one row, and the measure is the last column.
- Values show their game names and icons. Player names link to the player's profile and show their avatar.
- A value the save doesn't record appears as "Not recorded". That row is kept, not dropped.

### Limits

- Each IP address gets 300 requests per hour, shared between the catalog and queries. The setting is `AD_HOC_QUERY_PER_HOUR`.
- Only fields in the server's list can be queried. `online_id`, `discord_id` and `email` aren't in the list.

## Asking in plain language

### What the user sees

- The "Question" panel sits above the "Query" builder.
- You type a question and press Ask.
- The page fills the builder with the query the AI produced and shows the results. You can check that query and edit it.
- If the question can't be answered, one line appears under the box. The builder still works.
- A page opened from a link shows that query written out as a sentence in the box. If you type over it, your text stays.
- You must be signed in. If your session has expired, you go to sign-in and come back to the same page.

### What the server does (`POST /v1/query/ask`)

- It sends the question to DeepSeek V4.1 Flash on Cloudflare Workers AI. Temperature is 0 and reasoning effort is "none".
- The model answers by calling one tool, which returns an Explore selection.
- The server checks that answer:
  - The selection must parse like a hand-built URL.
  - Every enum value must be on the same lists the builder's pickers use.
  - Player and tournament names are matched in code, not by the model. An exact name match wins. Otherwise the typed name must be part of exactly one roster name.
- If a check fails, the model gets one retry with the error message. A second failure returns a 422.
- If the model says Explore can't answer the question, the user sees that reason.
- The browser then goes to the query URL, and the normal `GET /v1/query` answers it.

### Cache

- The same question on the same UTC day is answered from KV with no model call. Case and spacing are ignored.
- A cached answer doesn't count against the limits.
- Failures are not cached, because a name that matched nobody might match later that day.

### Limits

These are checked in this order, before any model call.

- 10 questions per account per 24 hours.
- 60 per IP address per hour.
- 300 in total per hour.
- A $5 budget per calendar month. Each question is first charged at its worst-case cost, then corrected to the real token count once it finishes.
- Every question that reaches the model is logged in the `query_asks` table. Rows older than 35 days are deleted by the nightly cleanup.

### Admin controls

- `./per-ankh admin ask off|on` turns the feature off or on. When it's off, cached answers are refused too.
- `./per-ankh admin ask status` shows whether it's on, plus this month's question count and spend.
- `./per-ankh admin cache clear ask` clears the cached answers.

### Other notes

- The question text goes into the access log, so a player's name can end up there.
- `npm run eval:ask` runs a 32-question test set. In the 2026-11-17 eval, Flash passed 95 of 96 across three runs, at about $0.003 per question.
