# Test Save Files

This directory contains Old World game save files for development and testing.

## Usage

- Place your Old World save files here for testing the parser
- All save files in this directory are ignored by git (except sample files)
- Sample files may be committed for automated testing

## File Format

Old World save files are **ZIP archives containing XML data**.

### Structure

- Save files have `.zip` extension (or possibly no extension)
- Inside each ZIP file is XML data with game state
- The parser will need to:
  1. Unzip the archive
  2. Extract and parse the XML content
  3. Load data into DuckDB
