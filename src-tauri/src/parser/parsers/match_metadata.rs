// Match-metadata pure-parse module.
//
// Parity-only counterpart to the legacy `import::insert_match_metadata`
// (src-tauri/src/parser/import.rs:1134–1282). Returns a serializable struct
// matching the TypeScript `MatchMetadata` envelope shape used by the cloud
// rewrite (`src/lib/parser/parsers/match-metadata.ts`).
//
// The desktop `insert_match_metadata` path is intentionally NOT refactored
// to call this — desktop is a working production deployment and we keep
// risk to that flow at zero. The three private helpers below
// (parse_version_string, parse_save_date, parse_game_content) are
// duplicated from import.rs; resync if any of those change upstream.

use crate::parser::game_data::PlayerData;
use crate::parser::xml_loader::{XmlDocument, XmlNodeExt};
use crate::parser::{ParseError, Result};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MatchMetadataStruct {
    pub xml_game_id: String,
    pub total_turns: i32,
    pub game_name: Option<String>,
    pub save_date: Option<String>,
    pub game_version: Option<String>,
    pub map_width: Option<i32>,
    pub map_height: Option<i32>,
    pub map_size: Option<String>,
    pub map_class: Option<String>,
    pub game_mode: Option<String>,
    pub difficulty: Option<String>,
    pub opponent_level: Option<String>,
    pub victory_conditions: Option<String>,
    pub enabled_mods: Option<String>,
    pub enabled_dlc: Option<String>,
    pub winner: Option<WinnerInfoStruct>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WinnerInfoStruct {
    pub winner_player_xml_id: i32,
    pub winner_team_id: Option<i32>,
    pub victory_type: String,
}

/// Parse match metadata + resolved winner. The `players` slice must already
/// be available — winner resolution can need to map `<TeamVictories>` team
/// id → owning player via Player @Team attributes.
pub fn parse_match_metadata_struct(
    doc: &XmlDocument,
    players: &[PlayerData],
) -> Result<MatchMetadataStruct> {
    let root = doc.root_element();
    let xml_game_id = root.req_attr("GameId")?.to_string();

    let game_node = root
        .children()
        .find(|n| n.has_tag_name("Game"))
        .ok_or_else(|| ParseError::MissingElement("Game".to_string()))?;
    let total_turns: i32 = game_node
        .opt_child_text("Turn")
        .and_then(|t| t.parse().ok())
        .ok_or_else(|| ParseError::MissingElement("Game.Turn".to_string()))?;

    let (game_version, enabled_mods) = root
        .opt_attr("Version")
        .map(parse_version_string)
        .unwrap_or((None, None));
    let enabled_dlc = parse_game_content(&root);
    let save_date = root.opt_attr("SaveDate").and_then(parse_save_date);

    let map_width: Option<i32> = root.opt_attr("MapWidth").and_then(|s| s.parse().ok());
    // MapHeight isn't encoded; the legacy code assumes square map.
    let map_height = map_width;

    let game_name = root
        .opt_attr("GameName")
        .or_else(|| root.opt_child_text("GameName"))
        .map(|s| s.to_string());

    let victory_conditions = root
        .children()
        .find(|n| n.has_tag_name("VictoryEnabled"))
        .map(|ve| {
            ve.children()
                .filter(|c| c.is_element())
                .map(|c| c.tag_name().name().to_string())
                .collect::<Vec<_>>()
                .join("+")
        })
        .filter(|s| !s.is_empty());

    let team_assignments: Vec<i32> = root
        .children()
        .find(|n| n.has_tag_name("Team"))
        .map(|team_elem| {
            team_elem
                .children()
                .filter(|n| n.has_tag_name("PlayerTeam"))
                .filter_map(|n| n.text().and_then(|t| t.parse::<i32>().ok()))
                .collect()
        })
        .unwrap_or_default();

    // Winner detection — same two-source strategy as the desktop:
    //   1. <Game><TeamVictories><Team Victory="...">team_id</Team>
    //   2. <Victory winner="player_xml_id" type="...">
    let winner = detect_winner(&root, &game_node, &team_assignments, players);

    Ok(MatchMetadataStruct {
        xml_game_id,
        total_turns,
        game_name,
        save_date,
        game_version,
        map_width,
        map_height,
        map_size: root.opt_attr("MapSize").map(|s| s.to_string()),
        map_class: root.opt_attr("MapClass").map(|s| s.to_string()),
        game_mode: root.opt_attr("GameMode").map(|s| s.to_string()),
        // Difficulty isn't a Root attribute in this XML shape; mirrors the
        // TS parser which reads `@_Difficulty` and yields null. Kept for
        // shape symmetry with the cloud blob's MatchMetadata.
        difficulty: root.opt_attr("Difficulty").map(|s| s.to_string()),
        opponent_level: root.opt_attr("OpponentLevel").map(|s| s.to_string()),
        victory_conditions,
        enabled_mods,
        enabled_dlc,
        winner,
    })
}

fn detect_winner(
    root: &roxmltree::Node,
    game_node: &roxmltree::Node,
    team_assignments: &[i32],
    players: &[PlayerData],
) -> Option<WinnerInfoStruct> {
    // Source 1: <Game><TeamVictories><Team Victory="...">winning_team_id</Team>
    if let Some(tv) = game_node.children().find(|n| n.has_tag_name("TeamVictories")) {
        if let Some(team) = tv.children().find(|n| n.has_tag_name("Team")) {
            let team_id = team.text().and_then(|t| t.parse::<i32>().ok());
            let victory_type = team.opt_attr("Victory").map(|s| s.to_string());
            if let (Some(team_id), Some(victory_type)) = (team_id, victory_type) {
                if let Some(player_xml_id) =
                    resolve_player_for_team(team_id, team_assignments, players)
                {
                    return Some(WinnerInfoStruct {
                        winner_player_xml_id: player_xml_id,
                        winner_team_id: Some(team_id),
                        victory_type,
                    });
                }
            }
        }
    }

    // Source 2: <Victory winner="player_xml_id" type="...">
    if let Some(v) = root.children().find(|n| n.has_tag_name("Victory")) {
        let winner_id = v.opt_attr("winner").and_then(|s| s.parse::<i32>().ok());
        let victory_type = v.opt_attr("type").map(|s| s.to_string());
        if let (Some(winner_id), Some(victory_type)) = (winner_id, victory_type) {
            return Some(WinnerInfoStruct {
                winner_player_xml_id: winner_id,
                winner_team_id: None,
                victory_type,
            });
        }
    }

    None
}

fn resolve_player_for_team(
    team_id: i32,
    team_assignments: &[i32],
    players: &[PlayerData],
) -> Option<i32> {
    // Strategy 1: index-by-position in <Team><PlayerTeam>… (Player XML id
    // == position).
    if let Some(idx) = team_assignments.iter().position(|&t| t == team_id) {
        return Some(idx as i32);
    }

    // Strategy 2: Player @Team attribute equals team_id (as string).
    let team_id_str = team_id.to_string();
    if let Some(p) = players
        .iter()
        .find(|p| p.team_id.as_ref() == Some(&team_id_str))
    {
        return Some(p.xml_id);
    }

    // Strategy 3: SP fallback — single human player. Only safe when exactly
    // one human is present; otherwise we'd guess.
    let humans: Vec<&PlayerData> = players.iter().filter(|p| p.is_human).collect();
    if humans.len() == 1 {
        return Some(humans[0].xml_id);
    }

    None
}

// ---------- Private helpers (duplicated from import.rs) ----------

/// Format: `Version: 1.0.70671+MOD_NAME=hash+MOD_NAME2=hash`. Returns
/// `(version_number, joined_mod_names)`. Mirrors `parse_version_string` at
/// import.rs:889–913.
fn parse_version_string(version: &str) -> (Option<String>, Option<String>) {
    let parts: Vec<&str> = version.split('+').collect();
    if parts.is_empty() {
        return (None, None);
    }

    let version_num = parts[0]
        .strip_prefix("Version: ")
        .map(|v| v.to_string());

    let mods = if parts.len() > 1 {
        let mod_parts: Vec<&str> = parts[1..]
            .iter()
            .map(|s| s.split('=').next().unwrap_or(s))
            .collect();
        Some(mod_parts.join("+"))
    } else {
        None
    };

    (version_num, mods)
}

/// Walk `<GameContent>` for `DLC_*` children. Mirrors `parse_game_content`
/// at import.rs:918–933.
fn parse_game_content(root: &roxmltree::Node) -> Option<String> {
    let game_content = root.children().find(|n| n.has_tag_name("GameContent"))?;
    let dlcs: Vec<&str> = game_content
        .children()
        .filter(|child| child.is_element())
        .map(|el| el.tag_name().name())
        .filter(|name| name.starts_with("DLC_"))
        .collect();
    if dlcs.is_empty() {
        None
    } else {
        Some(dlcs.join("+"))
    }
}

/// "31 January 2024" → ISO `YYYY-MM-DD`. Mirrors `parse_save_date` at
/// import.rs:937–944.
fn parse_save_date(date_str: &str) -> Option<String> {
    use chrono::NaiveDate;
    NaiveDate::parse_from_str(date_str, "%d %B %Y")
        .ok()
        .map(|d| d.format("%Y-%m-%d").to_string())
}
