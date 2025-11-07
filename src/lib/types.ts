export interface NationStats {
  nation: string;
  games_played: number;
}

export interface GameStatistics {
  total_games: number;
  nations: NationStats[];
}

export interface GameInfo {
  match_id: number;
  game_name: string | null;
  save_date: string | null;
  turn_year: number | null;
  human_nation: string | null;
  total_turns: number | null;
}

export interface GameDetails {
  match_id: number;
  game_name: string | null;
  save_date: string | null;
  total_turns: number;
  map_size: string | null;
  map_width: number | null;
  map_height: number | null;
  game_mode: string | null;
  opponent_level: string | null;
  players: PlayerInfo[];
}

export interface PlayerInfo {
  player_name: string;
  nation: string | null;
  is_human: boolean;
  legitimacy: number | null;
  state_religion: string | null;
}

export interface PlayerHistoryPoint {
  turn: number;
  points: number | null;
  military_power: number | null;
  legitimacy: number | null;
}

export interface PlayerHistory {
  player_id: number;
  player_name: string;
  history: PlayerHistoryPoint[];
}
