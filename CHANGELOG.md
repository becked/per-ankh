# Changelog

## [0.1.9] - 2026-01-31

### Added
- Support for new Old World save file format (game version 1.0.77+)
- Auto-detection of save owner in multiplayer games
- YieldTotalHistory data extraction for comprehensive yield tracking

### Fixed
- Winner determination in multiplayer games now correctly identifies the victor
- Comprehensive validation of save file references against actual data

## [0.1.8] - 2025-12-05

### Added
- Map tab with interactive hex visualization
  - Two modes: Political, Religion
  - Historical playback with turn-by-turn replay and fast-forward controls
  - Map markers for cities and improvements
  - Pan and zoom controls
  - Fullscreen mode with animated dialog
  - Rich tooltips showing tile details
- Improvements tab showing all tile improvements with sortable columns
- Unit data ingestion (units, promotions, effects, family associations)
- Expanded city data coverage with additional fields and tables
- Sortable columns in Cities and Event Logs tables
- Overview statistics now filter by selected collection

### Changed
- Enum display formatting now strips trailing numbers for cleaner output

### Fixed
- Page state now resets properly when navigating between games
- Cities tab culture level and units produced display correctly
- Database reset no longer fails with "sequence already exists" error
- Road data parsing corrected

## [0.1.7] - 2025-12-01

### Added
- Collections feature for organizing matches into custom groups
  - Create, rename, and delete collections via "Manage Collections" menu
  - Filter game list by collection in sidebar
  - Right-click context menu to move games between collections

### Changed
- Removed foreign key constraints from database schema for improved performance

### Fixed
- Collections context menu UX and styling improvements
- Prevent crash on schema upgrade with version file check

## [0.1.6] - 2025-11-24

### Added
- Release notes template with auto-versioning

### Changed
- Event Logs table and filters updated to dark theme

### Fixed
- CSS isolation to prevent chart overlap on Linux
- Games by Nation chart now counts only save owner's nation

## [0.1.5] - 2025-11-24

### Added
- Linux build targets (DEB and RPM packages)

## [0.1.4] - 2025-11-24

### Added
- Calendar chart on overview page showing play activity
- Egyptian hieroglyph parade animation during file import
- Primary user settings and save owner tracking
- Database corruption recovery with user dialog
- Player difficulty parsing and display from save files
- Mods and DLC parsing separated from save files
- Nation badge on sidebar game cards
- Win indicator trophy badge on sidebar game cards
- Series filter for all game details charts
- Fullscreen chart toggle with open/close animations
- Skeleton loading states for smoother page transitions
- Monthly separators in game sidebar
- Edge fade effect on hieroglyph parade
- Decorative hieroglyph borders on parade animation

### Fixed
- DuckDB WAL corruption on Windows
- Search filtering race condition
- Properly integrate search store with Svelte 5 runes
- Catch up on missed parade spawns when window returns to screen
- Import progress bar no longer jumps backwards
- Transparent icon margins filled to prevent light border

## [0.1.3] - 2025-11-20

### Added
- Law adoption history chart with nation filter and markers
- Fullscreen toggle for charts on game details page
- Event logs table with filtering, deduplication, and player extraction
- Victory type and conditions extraction and display
- Winner extraction from save file XML
- Map type display in game summary
- Nation names in chart legends and tooltips
- Reusable SearchInput component

### Changed
- Military power and legitimacy charts moved to Economics tab
- Chart styling: removed legends, improved typography
- Game details summary layout redesigned
- Game settings sections have light gray background

### Fixed
- Handle both MAPCLASS_ prefix formats in map name display
- Display victory type as separate metric in game summary

### Performance
- Added index on players(match_id, player_id) for winner JOIN optimization

## [0.1.2] - 2025-11-11

### Added
- Apple notarization for macOS releases

### Performance
- Parallel parsing with rayon (Phase 4 optimization)
- Benchmark binary for parser performance testing

## [0.1.1] - 2025-11-11

### Changed
- UI layout reorganized: sidebar on right, header elements swapped
- Logo updated from ankh symbol to Egyptian hieroglyph
- Search box moved from sidebar to header
- Various styling refinements (game sidebar, detail page)

### Fixed
- macOS code signing with Developer ID Application certificate
- Window dragging restored with missing permission
- Chart container null check added

## [0.1.0] - 2025-11-08

### Added
- Initial release
- Save file parsing for Old World game saves
- DuckDB database storage for game data
- File import UI with progress modal
- Overview page with aggregate statistics
- Game details page with multiple tabs:
  - Summary with victory conditions and winner
  - Economics tab with yield charts (food, wood, stone, iron, training, civics, money)
  - Science production chart
  - Military power and legitimacy charts
- Game sidebar with search functionality
- Nation-specific colors in all charts
- Real-time import progress events
- GitHub Actions release workflow

[Unreleased]: https://github.com/becked/per-ankh/compare/v0.1.9...HEAD
[0.1.9]: https://github.com/becked/per-ankh/compare/v0.1.8...v0.1.9
[0.1.8]: https://github.com/becked/per-ankh/compare/v0.1.7...v0.1.8
[0.1.7]: https://github.com/becked/per-ankh/compare/v0.1.6...v0.1.7
[0.1.6]: https://github.com/becked/per-ankh/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/becked/per-ankh/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/becked/per-ankh/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/becked/per-ankh/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/becked/per-ankh/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/becked/per-ankh/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/becked/per-ankh/releases/tag/v0.1.0
