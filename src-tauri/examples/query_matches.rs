use duckdb::Connection;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let conn = Connection::open("per-ankh.db")?;
    
    println!("=== Matches Table Data ===\n");
    
    let mut stmt = conn.prepare("
        SELECT
            game_version,
            enabled_dlc,
            CAST(save_date AS VARCHAR) as save_date,
            map_size,
            map_aspect_ratio,
            map_width,
            min_latitude,
            max_latitude,
            game_mode,
            opponent_level,
            development,
            first_seed,
            turn_style,
            succession_gender,
            succession_order
        FROM matches
    ")?;

    let mut rows = stmt.query([])?;

    while let Some(row) = rows.next()? {
        let game_version: Option<String> = row.get(0)?;
        let enabled_dlc: Option<String> = row.get(1)?;
        let save_date: Option<String> = row.get(2)?;
        let map_size: Option<String> = row.get(3)?;
        let map_aspect_ratio: Option<String> = row.get(4)?;
        let map_width: Option<i32> = row.get(5)?;
        let min_lat: Option<i32> = row.get(6)?;
        let max_lat: Option<i32> = row.get(7)?;
        let game_mode: Option<String> = row.get(8)?;
        let opponent_level: Option<String> = row.get(9)?;
        let development: Option<String> = row.get(10)?;
        let first_seed: Option<i64> = row.get(11)?;
        let turn_style: Option<String> = row.get(12)?;
        let succession_gender: Option<String> = row.get(13)?;
        let succession_order: Option<String> = row.get(14)?;

        println!("Game Version: {:?}", game_version);
        println!("Enabled DLC: {:?}", enabled_dlc.as_ref().map(|s| if s.len() > 80 { format!("{}...", &s[..80]) } else { s.clone() }));
        println!("Save Date: {:?}", save_date);
        println!("Map Size: {:?}", map_size);
        println!("Map Aspect Ratio: {:?}", map_aspect_ratio);
        println!("Map Width: {:?}", map_width);
        println!("Latitude Range: {:?} to {:?}", min_lat, max_lat);
        println!("Game Mode: {:?}", game_mode);
        println!("Turn Style: {:?}", turn_style);
        println!("Opponent Level: {:?}", opponent_level);
        println!("Development: {:?}", development);
        println!("Succession: {:?} / {:?}", succession_gender, succession_order);
        println!("First Seed: {:?}", first_seed);
    }

    // Query religions
    println!("\n=== Religions ===\n");
    let mut stmt = conn.prepare("SELECT religion_name, founded_turn, head_character_id, holy_city_id FROM religions ORDER BY founded_turn")?;
    let mut rows = stmt.query([])?;
    let mut religion_count = 0;
    while let Some(row) = rows.next()? {
        let name: String = row.get(0)?;
        let founded: Option<i32> = row.get(1)?;
        let head: Option<i64> = row.get(2)?;
        let city: Option<i64> = row.get(3)?;
        println!("{}: founded turn {:?}, head={:?}, holy_city={:?}", name, founded, head, city);
        religion_count += 1;
    }
    println!("\nTotal religions: {}", religion_count);

    // Query character relationships
    println!("\n=== Character Relationships (sample) ===\n");
    let mut stmt = conn.prepare("SELECT character_id, related_character_id, relationship_type, started_turn FROM character_relationships LIMIT 10")?;
    let mut rows = stmt.query([])?;
    let mut relationship_count = 0;
    while let Some(row) = rows.next()? {
        let char_id: i64 = row.get(0)?;
        let related_id: i64 = row.get(1)?;
        let rel_type: String = row.get(2)?;
        let turn: Option<i32> = row.get(3)?;
        println!("Character {} -> Character {}: {} (turn {:?})", char_id, related_id, rel_type, turn);
        relationship_count += 1;
    }

    let total_relationships: i64 = conn.query_row("SELECT COUNT(*) FROM character_relationships", [], |row| row.get(0))?;
    println!("\nShowing {} of {} total relationships", relationship_count, total_relationships);

    Ok(())
}
