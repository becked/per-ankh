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
}
