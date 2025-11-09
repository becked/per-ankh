#!/usr/bin/env python3
"""
Analyze Old World save files to understand dynasty encoding format evolution.

This script examines save files to determine:
1. How Greek successor dynasties (Diadochi) are encoded
2. Whether the format changed between game versions
3. The relationship between Nation and Dynasty attributes
"""

import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path
from collections import defaultdict
from typing import Dict, List, Tuple, Optional
import sys
import re

# Greek successor dynasties we're investigating
DIADOCHI_NATIONS = {'NATION_SELEUCUS', 'NATION_ANTIGONUS', 'NATION_PTOLEMY'}
EXPECTED_MAPPINGS = {
    'NATION_SELEUCUS': ('NATION_GREECE', 'DYNASTY_SELEUCID'),
    'NATION_ANTIGONUS': ('NATION_GREECE', 'DYNASTY_ANTIGONID'),
    'NATION_PTOLEMY': ('NATION_GREECE', 'DYNASTY_PTOLEMY'),  # Macedonian/Greek dynasty
}

class SaveFileAnalysis:
    """Analysis results for a single save file"""
    def __init__(self, filepath: Path):
        self.filepath = filepath
        self.filename = filepath.name
        self.file_mtime = filepath.stat().st_mtime if filepath.exists() else None
        self.game_id: Optional[str] = None
        self.game_version: Optional[str] = None
        self.save_date: Optional[str] = None
        self.players: List[Dict[str, str]] = []
        self.has_diadochi = False
        self.diadochi_as_nations = False  # True if encoded as separate nations
        self.diadochi_as_dynasties = False  # True if encoded as dynasties

    def __repr__(self) -> str:
        return f"<SaveFileAnalysis: {self.filename}, players={len(self.players)}, diadochi={self.has_diadochi}>"

def extract_xml_from_save(save_path: Path) -> Optional[str]:
    """Extract XML from a save file (.zip)"""
    try:
        with zipfile.ZipFile(save_path, 'r') as zf:
            file_list = zf.namelist()

            # Try common names
            if 'game.xml' in file_list:
                return zf.read('game.xml').decode('utf-8')

            # Look for any .xml file
            xml_files = [f for f in file_list if f.endswith('.xml')]
            if xml_files:
                # Use the first .xml file found
                return zf.read(xml_files[0]).decode('utf-8')

            print(f"Warning: No .xml file found in {save_path.name}")
            return None
    except Exception as e:
        print(f"Error reading {save_path.name}: {e}")
        return None

def analyze_save_file(save_path: Path) -> Optional[SaveFileAnalysis]:
    """Analyze a single save file"""
    analysis = SaveFileAnalysis(save_path)

    # Extract XML
    xml_content = extract_xml_from_save(save_path)
    if not xml_content:
        return None

    try:
        root = ET.fromstring(xml_content)
    except ET.ParseError as e:
        print(f"XML parse error in {save_path.name}: {e}")
        return None

    # Extract metadata
    analysis.game_id = root.get('GameId')
    analysis.game_version = root.get('Version')  # May not exist
    analysis.save_date = root.get('SaveDate')  # May not exist

    # Find all Player elements
    for player_elem in root.findall('.//Player'):
        player_data = {
            'id': player_elem.get('ID'),
            'name': player_elem.get('Name'),
            'nation': player_elem.get('Nation'),
            'dynasty': player_elem.get('Dynasty'),
        }
        analysis.players.append(player_data)

        nation = player_data['nation']
        dynasty = player_data['dynasty']

        # Check for Diadochi encoding patterns
        if nation in DIADOCHI_NATIONS:
            analysis.has_diadochi = True
            analysis.diadochi_as_nations = True

        # Check if this is a Greece player with Diadochi dynasty
        if nation == 'NATION_GREECE' and dynasty in ('DYNASTY_SELEUCID', 'DYNASTY_ANTIGONID', 'DYNASTY_PTOLEMY'):
            analysis.has_diadochi = True
            analysis.diadochi_as_dynasties = True

    return analysis

def find_save_files(search_paths: List[Path]) -> List[Path]:
    """Find all Old World save files in the given paths"""
    save_files = []

    for search_path in search_paths:
        if not search_path.exists():
            print(f"Path does not exist: {search_path}")
            continue

        if search_path.is_file() and search_path.suffix == '.zip':
            save_files.append(search_path)
        elif search_path.is_dir():
            # Recursively find all .zip files
            save_files.extend(search_path.rglob('*.zip'))

    return sorted(save_files, key=lambda p: p.stat().st_mtime)

def print_analysis_summary(analyses: List[SaveFileAnalysis]):
    """Print summary of all analyses"""
    print("\n" + "="*80)
    print("DYNASTY FORMAT ANALYSIS SUMMARY")
    print("="*80)

    total = len(analyses)
    with_diadochi = [a for a in analyses if a.has_diadochi]
    as_nations = [a for a in analyses if a.diadochi_as_nations]
    as_dynasties = [a for a in analyses if a.diadochi_as_dynasties]

    print(f"\nTotal save files analyzed: {total}")
    print(f"Files with Diadochi (Greek successors): {len(with_diadochi)}")
    print(f"  - Encoded as separate nations: {len(as_nations)}")
    print(f"  - Encoded as dynasties: {len(as_dynasties)}")

    if as_nations and as_dynasties:
        print("\n⚠️  WARNING: BOTH FORMATS DETECTED!")
        print("   This confirms the format changed between game versions.")
    elif as_nations:
        print("\n✓  All Diadochi encoded as separate nations (legacy format)")
    elif as_dynasties:
        print("\n✓  All Diadochi encoded as dynasties (modern format)")

    # Detailed breakdown
    if with_diadochi:
        print("\n" + "-"*80)
        print("DETAILED BREAKDOWN")
        print("-"*80)

        for analysis in with_diadochi:
            import datetime
            date_str = datetime.datetime.fromtimestamp(analysis.file_mtime).strftime('%Y-%m-%d %H:%M')

            print(f"\n{analysis.filename}")
            print(f"  Modified: {date_str}")
            if analysis.game_version:
                print(f"  Version: {analysis.game_version}")
            if analysis.save_date:
                print(f"  Save Date: {analysis.save_date}")

            # Show Diadochi players
            diadochi_players = [
                p for p in analysis.players
                if p['nation'] in DIADOCHI_NATIONS
                or (p['nation'] == 'NATION_GREECE'
                    and p['dynasty'] in ('DYNASTY_SELEUCID', 'DYNASTY_ANTIGONID', 'DYNASTY_PTOLEMY'))
            ]

            for player in diadochi_players:
                nation = player['nation']
                dynasty = player['dynasty'] or 'None'
                print(f"    Player: {player['name']}")
                print(f"      Nation={nation}, Dynasty={dynasty}")

                if nation in DIADOCHI_NATIONS:
                    expected = EXPECTED_MAPPINGS[nation]
                    print(f"      → Format: LEGACY (separate nation)")
                    print(f"      → Expected modern: Nation={expected[0]}, Dynasty={expected[1]}")
                else:
                    print(f"      → Format: MODERN (dynasty-based)")

def main():
    """Main entry point"""
    print("Old World Save File Dynasty Format Analyzer")
    print("="*80)

    # Default search paths
    default_paths = [
        Path.home() / "Documents" / "My Games" / "OldWorld" / "Save",
        Path.home() / "Documents" / "My Games" / "OldWorld" / "Saves",
        Path.home() / "Library" / "Application Support" / "OldWorld" / "Save",
        Path.home() / "Library" / "Application Support" / "OldWorld" / "Saves",
    ]

    # Allow custom path as argument
    if len(sys.argv) > 1:
        search_paths = [Path(p) for p in sys.argv[1:]]
    else:
        search_paths = [p for p in default_paths if p.exists()]

    if not search_paths:
        print("No save directories found. Please provide a path as an argument.")
        print(f"Usage: {sys.argv[0]} <path_to_saves>")
        return 1

    print(f"\nSearching in:")
    for path in search_paths:
        print(f"  - {path}")

    # Find all save files
    save_files = find_save_files(search_paths)

    if not save_files:
        print("\nNo save files found!")
        return 1

    print(f"\nFound {len(save_files)} save file(s)")
    print("Analyzing...\n")

    # Analyze each file
    analyses = []
    for save_file in save_files:
        print(f"Analyzing: {save_file.name}...", end=' ')
        analysis = analyze_save_file(save_file)
        if analysis:
            analyses.append(analysis)
            status = "✓" if analysis.has_diadochi else "-"
            print(f"{status} ({len(analysis.players)} players)")
        else:
            print("✗ (failed)")

    # Print summary
    print_analysis_summary(analyses)

    return 0

if __name__ == '__main__':
    sys.exit(main())
