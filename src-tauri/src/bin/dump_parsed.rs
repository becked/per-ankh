// Parity test harness: dump every parser's output as one JSON envelope.
//
// See docs/cloud-rewrite-spec.md §2 ("Parity Test Harness"). This bin is
// transient — it lives until the TypeScript parser port reaches parity, then
// is deleted with the rest of the Rust code. The dump format is a wire
// protocol between this bin and `scripts/parity/diff.ts`, not the in-app data
// shape.
//
// Conventions:
// - snake_case field names (Rust serde defaults).
// - i64 fields serialized as JSON strings (JS Number can't safely hold i64).
// - Every row in every collection gets a `dump_index` field at its array
//   position so the diff can break ties when configured sort keys aren't
//   unique.

use anyhow::{anyhow, bail, Context, Result};
use per_ankh_lib::parser::{
    parsers,
    save_file::{compute_file_hash, validate_and_extract_xml},
    xml_loader::parse_xml,
};
use serde::Serialize;
use serde_json::{json, Map, Value};
use std::env;
use std::fs;
use std::path::PathBuf;

const SCHEMA_VERSION: u32 = 1;

struct Args {
    save: PathBuf,
    out: PathBuf,
    pretty: bool,
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
                    "usage: dump_parsed --save <path/to/save.zip> --out <path/to/dump.json> [--pretty]"
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

/// Convert a slice of serializable rows into a JSON array where each element
/// gains a `dump_index` field at its array position, and any field name in
/// `i64_string_fields` is rewritten from a JSON number to a JSON string.
///
/// Null i64 values stay null. Non-i64 values found at the named field are
/// left untouched (defensive — should not occur given the field list is
/// hand-curated against `game_data.rs` i64 fields).
fn rows_with_index<T: Serialize>(rows: &[T], i64_string_fields: &[&str]) -> Value {
    let arr: Vec<Value> = rows
        .iter()
        .enumerate()
        .map(|(i, row)| {
            let mut value = serde_json::to_value(row).expect("row must serialize as JSON");
            let map = value
                .as_object_mut()
                .expect("row must serialize as JSON object");
            map.insert("dump_index".into(), json!(i));
            for field in i64_string_fields {
                if let Some(slot) = map.get_mut(*field) {
                    if let Some(n) = slot.as_i64() {
                        *slot = Value::String(n.to_string());
                    }
                }
            }
            value
        })
        .collect();
    Value::Array(arr)
}

fn main() -> Result<()> {
    let args = parse_args()?;

    let save_str = args
        .save
        .to_str()
        .ok_or_else(|| anyhow!("--save path must be valid UTF-8"))?;

    let xml = validate_and_extract_xml(save_str).context("extract save XML")?;
    let xml_doc = parse_xml(xml).context("parse XML")?;
    let save_sha = compute_file_hash(save_str).context("hash save file")?;

    // Foundation entities. The parsers module exposes a rayon-parallel
    // orchestrator; we call serially here because the bin is invoked once per
    // save by an outer driver that already parallelizes across saves.
    let players = parsers::parse_players_struct(&xml_doc).context("parse_players_struct")?;
    let characters =
        parsers::parse_characters_struct(&xml_doc).context("parse_characters_struct")?;
    let cities = parsers::parse_cities_struct(&xml_doc).context("parse_cities_struct")?;
    let tiles = parsers::parse_tiles_struct(&xml_doc).context("parse_tiles_struct")?;

    // Affiliation entities.
    let families = parsers::parse_families_struct(&xml_doc).context("parse_families_struct")?;
    let religions = parsers::parse_religions_struct(&xml_doc).context("parse_religions_struct")?;
    let tribes = parsers::parse_tribes_struct(&xml_doc).context("parse_tribes_struct")?;
    let player_units_produced = parsers::parse_player_units_produced(&xml_doc)
        .context("parse_player_units_produced")?;
    let city_units_produced =
        parsers::parse_city_units_produced(&xml_doc).context("parse_city_units_produced")?;

    // Character extended data takes the underlying roxmltree::Document, not
    // the XmlDocument wrapper.
    let (character_stats, character_traits, character_relationships, character_marriages) =
        parsers::parse_all_character_data_struct(xml_doc.document())
            .context("parse_all_character_data_struct")?;

    // City extended data.
    let city_production_queue = parsers::parse_city_production_queue_struct(&xml_doc)
        .context("parse_city_production_queue_struct")?;
    let city_projects_completed = parsers::parse_city_projects_completed_struct(&xml_doc)
        .context("parse_city_projects_completed_struct")?;
    let city_project_counts = parsers::parse_city_project_counts_struct(&xml_doc)
        .context("parse_city_project_counts_struct")?;
    let city_enemy_agents = parsers::parse_city_enemy_agents_struct(&xml_doc)
        .context("parse_city_enemy_agents_struct")?;
    let city_luxuries =
        parsers::parse_city_luxuries_struct(&xml_doc).context("parse_city_luxuries_struct")?;
    let city_yields =
        parsers::parse_city_yields_struct(&xml_doc).context("parse_city_yields_struct")?;
    let city_religions =
        parsers::parse_city_religions_struct(&xml_doc).context("parse_city_religions_struct")?;
    let city_culture =
        parsers::parse_city_culture_struct(&xml_doc).context("parse_city_culture_struct")?;

    // Tile extended data.
    let tile_visibility = parsers::parse_tile_visibility_struct(&xml_doc)
        .context("parse_tile_visibility_struct")?;
    let tile_changes =
        parsers::parse_tile_changes_struct(&xml_doc).context("parse_tile_changes_struct")?;

    // Units (composite return).
    let parsed_units = parsers::parse_units_struct(&xml_doc).context("parse_units_struct")?;

    // Player nested data (composite return — collection field names diverge
    // from the envelope wire names below).
    let player_data =
        parsers::parse_all_player_data(&xml_doc).context("parse_all_player_data")?;

    let diplomacy_relations =
        parsers::parse_diplomacy_relations(&xml_doc).context("parse_diplomacy_relations")?;

    // Timeseries.
    let yield_price_history = parsers::parse_yield_price_history_struct(&xml_doc)
        .context("parse_yield_price_history_struct")?;
    let (
        military_power_history,
        points_history,
        legitimacy_history,
        yield_rate_history,
        yield_total_history,
        family_opinion_history,
        religion_opinion_history,
    ) = parsers::parse_all_player_timeseries(&xml_doc)
        .context("parse_all_player_timeseries")?;

    // Events (3-tuple return).
    let (event_stories, event_logs, memory_data) =
        parsers::parse_events_struct(&xml_doc).context("parse_events_struct")?;

    // Build envelope as a Map directly (the json! macro hits recursion limits
    // on a flat object this large).
    let mut envelope = Map::with_capacity(64);
    envelope.insert("schema_version".into(), json!(SCHEMA_VERSION));
    envelope.insert("save_path".into(), Value::String(save_str.to_string()));
    envelope.insert("save_sha256".into(), Value::String(save_sha));

    envelope.insert("players".into(), rows_with_index(&players, &[]));
    envelope.insert("characters".into(), rows_with_index(&characters, &["seed"]));
    envelope.insert("cities".into(), rows_with_index(&cities, &[]));
    envelope.insert(
        "tiles".into(),
        rows_with_index(&tiles, &["init_seed", "turn_seed"]),
    );

    envelope.insert("families".into(), rows_with_index(&families, &[]));
    envelope.insert("religions".into(), rows_with_index(&religions, &[]));
    envelope.insert("tribes".into(), rows_with_index(&tribes, &[]));
    envelope.insert(
        "player_units_produced".into(),
        rows_with_index(&player_units_produced, &[]),
    );
    envelope.insert(
        "city_units_produced".into(),
        rows_with_index(&city_units_produced, &[]),
    );

    envelope.insert(
        "character_stats".into(),
        rows_with_index(&character_stats, &[]),
    );
    envelope.insert(
        "character_traits".into(),
        rows_with_index(&character_traits, &[]),
    );
    envelope.insert(
        "character_relationships".into(),
        rows_with_index(&character_relationships, &[]),
    );
    envelope.insert(
        "character_marriages".into(),
        rows_with_index(&character_marriages, &[]),
    );

    envelope.insert(
        "city_production_queue".into(),
        rows_with_index(&city_production_queue, &[]),
    );
    envelope.insert(
        "city_projects_completed".into(),
        rows_with_index(&city_projects_completed, &[]),
    );
    envelope.insert(
        "city_project_counts".into(),
        rows_with_index(&city_project_counts, &[]),
    );
    envelope.insert(
        "city_enemy_agents".into(),
        rows_with_index(&city_enemy_agents, &[]),
    );
    envelope.insert("city_luxuries".into(), rows_with_index(&city_luxuries, &[]));
    envelope.insert("city_yields".into(), rows_with_index(&city_yields, &[]));
    envelope.insert(
        "city_religions".into(),
        rows_with_index(&city_religions, &[]),
    );
    envelope.insert("city_culture".into(), rows_with_index(&city_culture, &[]));

    envelope.insert(
        "tile_visibility".into(),
        rows_with_index(&tile_visibility, &[]),
    );
    envelope.insert("tile_changes".into(), rows_with_index(&tile_changes, &[]));

    envelope.insert(
        "units".into(),
        rows_with_index(&parsed_units.units, &["seed"]),
    );
    envelope.insert(
        "unit_promotions".into(),
        rows_with_index(&parsed_units.promotions, &[]),
    );
    envelope.insert(
        "unit_effects".into(),
        rows_with_index(&parsed_units.effects, &[]),
    );
    envelope.insert(
        "unit_families".into(),
        rows_with_index(&parsed_units.families, &[]),
    );

    envelope.insert(
        "player_resources".into(),
        rows_with_index(&player_data.resources, &[]),
    );
    envelope.insert(
        "technology_progress".into(),
        rows_with_index(&player_data.tech_progress, &[]),
    );
    envelope.insert(
        "technologies_completed".into(),
        rows_with_index(&player_data.tech_completed, &[]),
    );
    envelope.insert(
        "technology_states".into(),
        rows_with_index(&player_data.tech_states, &[]),
    );
    envelope.insert(
        "player_council".into(),
        rows_with_index(&player_data.council, &[]),
    );
    envelope.insert("laws".into(), rows_with_index(&player_data.laws, &[]));
    envelope.insert(
        "player_goals".into(),
        rows_with_index(&player_data.goals, &[]),
    );

    envelope.insert(
        "diplomacy_relations".into(),
        rows_with_index(&diplomacy_relations, &[]),
    );

    envelope.insert(
        "yield_price_history".into(),
        rows_with_index(&yield_price_history, &[]),
    );
    envelope.insert(
        "military_power_history".into(),
        rows_with_index(&military_power_history, &[]),
    );
    envelope.insert(
        "points_history".into(),
        rows_with_index(&points_history, &[]),
    );
    envelope.insert(
        "legitimacy_history".into(),
        rows_with_index(&legitimacy_history, &[]),
    );
    envelope.insert(
        "yield_rate_history".into(),
        rows_with_index(&yield_rate_history, &[]),
    );
    envelope.insert(
        "yield_total_history".into(),
        rows_with_index(&yield_total_history, &[]),
    );
    envelope.insert(
        "family_opinion_history".into(),
        rows_with_index(&family_opinion_history, &[]),
    );
    envelope.insert(
        "religion_opinion_history".into(),
        rows_with_index(&religion_opinion_history, &[]),
    );

    envelope.insert(
        "event_stories".into(),
        rows_with_index(&event_stories, &[]),
    );
    envelope.insert("event_logs".into(), rows_with_index(&event_logs, &[]));
    envelope.insert("memory_data".into(), rows_with_index(&memory_data, &[]));

    let envelope = Value::Object(envelope);

    let output = if args.pretty {
        serde_json::to_string_pretty(&envelope)?
    } else {
        serde_json::to_string(&envelope)?
    };
    fs::write(&args.out, output)
        .with_context(|| format!("write dump to {}", args.out.display()))?;
    Ok(())
}
