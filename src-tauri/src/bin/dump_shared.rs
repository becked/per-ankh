// Share-parity test harness: dump SharedGameData JSON for one save.
//
// The desktop produces a SharedGameData blob via:
//   1. import_save_file (extract + parse + insert into temp DuckDB)
//   2. assemble_shared_game_data (run 14 queries, build the blob)
//
// This bin runs both phases against a temp DB and emits the JSON. Pairs with
// `scripts/parity/share-dump.ts` (TS orchestrator emitting the equivalent
// SharedGameData-overlapping subset of FullGameData) and the share-diff CLI
// for whole-blob parity verification.
//
// app_version is fixed to "0.0.0-parity" in both dumpers so the field never
// drifts. created_at differs between runs and is normalized at diff time.

use anyhow::{anyhow, bail, Context, Result};
use per_ankh_lib::db::queries::share::assemble_shared_game_data;
use per_ankh_lib::db::schema::ensure_schema_ready;
use per_ankh_lib::parser::import_save_file;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const APP_VERSION: &str = "0.0.0-parity";

struct Args {
    save: PathBuf,
    out: PathBuf,
    pretty: bool,
}

/// Trim "YYYY-MM-DD HH:MM:SS" → "YYYY-MM-DD" on `game_details.save_date`.
/// No-op when the field is null or already short.
fn normalize_save_date(value: &mut serde_json::Value) {
    let game_details = match value.get_mut("game_details") {
        Some(g) => g,
        None => return,
    };
    let map = match game_details.as_object_mut() {
        Some(m) => m,
        None => return,
    };
    let slot = match map.get_mut("save_date") {
        Some(s) => s,
        None => return,
    };
    if let Some(s) = slot.as_str() {
        if s.len() == 19 && s.as_bytes().get(10) == Some(&b' ') {
            *slot = serde_json::Value::String(s[..10].to_string());
        }
    }
}

fn make_scratch_dir(save_path: &str) -> Result<PathBuf> {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let pid = std::process::id();
    // Mix in the save path's hash too — multiple parallel invocations can
    // sample the same nanos at sub-microsecond granularity, and PIDs alone
    // aren't enough when concurrency exceeds the kernel's PID rotation
    // window. The save path is the natural unique key.
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut hasher = DefaultHasher::new();
    save_path.hash(&mut hasher);
    let save_hash = hasher.finish();
    let path: PathBuf =
        env::temp_dir().join(format!("dump_shared-{pid}-{nanos}-{save_hash:x}"));
    fs::create_dir_all(&path)
        .with_context(|| format!("create_dir_all({})", path.display()))?;
    Ok(path)
}

/// Best-effort cleanup of the scratch directory. Logged but not fatal.
fn cleanup_scratch(p: &Path) {
    let _ = fs::remove_dir_all(p);
}

fn parse_args() -> Result<Args> {
    let mut save: Option<PathBuf> = None;
    let mut out: Option<PathBuf> = None;
    let mut pretty = false;
    let mut iter = env::args().skip(1);
    while let Some(arg) = iter.next() {
        match arg.as_str() {
            "--save" => {
                save = Some(
                    iter.next()
                        .ok_or_else(|| anyhow!("--save requires a value"))?
                        .into(),
                );
            }
            "--out" => {
                out = Some(
                    iter.next()
                        .ok_or_else(|| anyhow!("--out requires a value"))?
                        .into(),
                );
            }
            "--pretty" => pretty = true,
            "-h" | "--help" => {
                eprintln!(
                    "usage: dump_shared --save <path/to/save.zip> --out <path/to/dump.json> [--pretty]"
                );
                std::process::exit(0);
            }
            _ => bail!("unknown argument: {}", arg),
        }
    }
    Ok(Args {
        save: save.ok_or_else(|| anyhow!("--save is required"))?,
        out: out.ok_or_else(|| anyhow!("--out is required"))?,
        pretty,
    })
}

fn main() -> Result<()> {
    let args = parse_args()?;

    let save_str = args
        .save
        .to_str()
        .ok_or_else(|| anyhow!("--save path must be valid UTF-8"))?;

    // Temp DB. tempfile is dev-only in Cargo.toml so we roll our own scratch
    // dir to keep this binary in the runtime build's dep graph clean.
    let scratch_dir = make_scratch_dir(save_str).context("create scratch dir")?;
    let db_path = scratch_dir.join("share.db");
    let conn = duckdb::Connection::open(&db_path).context("open temp db")?;
    ensure_schema_ready(&conn).context("ensure schema")?;

    let import_result =
        import_save_file(save_str, &conn, None, None, None, None, None).context("import save")?;

    if !import_result.success {
        bail!(
            "import failed: {}",
            import_result.error.unwrap_or_else(|| "unknown".into())
        );
    }
    let match_id = import_result
        .match_id
        .ok_or_else(|| anyhow!("import succeeded but match_id is None"))?;

    let shared = assemble_shared_game_data(&conn, match_id, APP_VERSION)
        .context("assemble_shared_game_data")?;

    // Normalize save_date: DuckDB CASTs DATE→VARCHAR as "YYYY-MM-DD HH:MM:SS";
    // the cloud parser's TS output is plain "YYYY-MM-DD". Strip the time
    // suffix here so the share-diff sees identical strings.
    let mut value = serde_json::to_value(&shared).context("serialize shared")?;
    normalize_save_date(&mut value);

    let output = if args.pretty {
        serde_json::to_string_pretty(&value)?
    } else {
        serde_json::to_string(&value)?
    };
    fs::write(&args.out, output)
        .with_context(|| format!("write dump to {}", args.out.display()))?;

    drop(conn);
    cleanup_scratch(&scratch_dir);
    Ok(())
}
