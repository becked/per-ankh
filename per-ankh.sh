#!/bin/bash
# Per-Ankh Development Helper Script
# Provides common functions for working with the Per-Ankh application

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_DB="per-ankh.db"
TEST_SAVES_DIR="$PROJECT_ROOT/test-data/saves"
RUST_DIR="$PROJECT_ROOT/src-tauri"

# Helper functions
print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

# Check if required tools are installed
check_requirements() {
    local missing=0

    if ! command -v cargo &> /dev/null; then
        print_error "cargo not found. Please install Rust: https://rustup.rs/"
        missing=1
    fi

    if ! command -v npm &> /dev/null; then
        print_error "npm not found. Please install Node.js: https://nodejs.org/"
        missing=1
    fi

    if [ $missing -eq 1 ]; then
        exit 1
    fi
}

# Import a single save file
import_save() {
    local save_file="$1"
    local db_path="${2:-$DEFAULT_DB}"

    if [ -z "$save_file" ]; then
        print_error "No save file specified"
        echo "Usage: $0 import <save_file.zip> [database.db]"
        exit 1
    fi

    if [ ! -f "$save_file" ]; then
        print_error "Save file not found: $save_file"
        exit 1
    fi

    # Convert to absolute paths (needed since we cd to src-tauri)
    local abs_save_file="$(cd "$(dirname "$save_file")" && pwd)/$(basename "$save_file")"
    local abs_db_path
    if [[ "$db_path" = /* ]]; then
        # Already absolute
        abs_db_path="$db_path"
    else
        # Make relative path absolute from project root
        abs_db_path="$PROJECT_ROOT/$db_path"
    fi

    print_info "Importing save file: $save_file"
    print_info "Database: $db_path"

    cd "$RUST_DIR"
    cargo run --example import_save --release -- "$abs_save_file" --db "$abs_db_path"

    print_success "Import completed"
}

# Import all save files in a directory
import_all() {
    local saves_dir="${1:-$TEST_SAVES_DIR}"
    local db_path="${2:-$DEFAULT_DB}"
    local pattern="${3:-*.zip}"

    if [ ! -d "$saves_dir" ]; then
        print_error "Directory not found: $saves_dir"
        exit 1
    fi

    print_info "Importing all saves from: $saves_dir"
    print_info "Pattern: $pattern"
    print_info "Database: $db_path"

    local count=0
    local success=0
    local failed=0

    for save_file in "$saves_dir"/$pattern; do
        if [ -f "$save_file" ]; then
            count=$((count + 1))
            print_info "[$count] Importing: $(basename "$save_file")"

            if import_save "$save_file" "$db_path"; then
                success=$((success + 1))
            else
                failed=$((failed + 1))
                print_warning "Failed to import: $(basename "$save_file")"
            fi
        fi
    done

    print_success "Import complete: $success succeeded, $failed failed out of $count total"
}

# Get the Tauri app data directory path
get_app_data_dir() {
    local os_type="$(uname -s)"
    case "$os_type" in
        Darwin*)
            echo "$HOME/Library/Application Support/com.becked.per-ankh"
            ;;
        Linux*)
            echo "$HOME/.local/share/com.becked.per-ankh"
            ;;
        MINGW*|MSYS*|CYGWIN*)
            echo "$APPDATA/com.becked.per-ankh"
            ;;
        *)
            print_error "Unsupported operating system: $os_type"
            return 1
            ;;
    esac
}

# Remove the database
clean_db() {
    local db_path="${1:-$DEFAULT_DB}"
    local removed=0

    # Clean development/test database (current directory)
    if [ -f "$db_path" ]; then
        print_warning "Removing development database: $db_path"
        rm -f "$db_path"
        print_success "Development database removed"
        removed=1

        # Also remove any .wal or .shm files (SQLite/DuckDB journal files)
        if [ -f "${db_path}.wal" ]; then
            rm -f "${db_path}.wal"
            print_info "Removed WAL file"
        fi
    else
        print_info "Development database not found: $db_path"
    fi

    # Clean Tauri app database (platform-specific location)
    local app_data_dir=$(get_app_data_dir)
    if [ $? -eq 0 ]; then
        local app_db_path="$app_data_dir/per-ankh.db"
        if [ -f "$app_db_path" ]; then
            print_warning "Removing Tauri app database: $app_db_path"
            rm -f "$app_db_path"
            print_success "Tauri app database removed"
            removed=1

            if [ -f "${app_db_path}.wal" ]; then
                rm -f "${app_db_path}.wal"
                print_info "Removed app WAL file"
            fi
        else
            print_info "Tauri app database not found: $app_db_path"
        fi
    fi

    if [ $removed -eq 0 ]; then
        print_warning "No databases found to clean"
    fi
}

# Run the application in development mode
run_dev() {
    print_info "Starting application in development mode..."
    cd "$PROJECT_ROOT"
    npm run tauri dev
}

# Build the application for distribution
build_app() {
    print_info "Building application for distribution..."
    cd "$PROJECT_ROOT"
    npm run tauri build
    print_success "Build complete. Check src-tauri/target/release/bundle/"
}

# Run Rust tests
run_tests() {
    local test_name="$1"

    print_info "Running Rust tests..."
    cd "$RUST_DIR"

    if [ -n "$test_name" ]; then
        cargo test "$test_name" -- --nocapture
    else
        cargo test
    fi
}

# Run Rust tests in release mode
run_tests_release() {
    local test_name="$1"

    print_info "Running Rust tests (release mode)..."
    cd "$RUST_DIR"

    if [ -n "$test_name" ]; then
        cargo test "$test_name" --release -- --nocapture
    else
        cargo test --release
    fi
}

# Check code quality
check_code() {
    print_info "Checking Rust code..."
    cd "$RUST_DIR"

    print_info "Running cargo check..."
    cargo check

    print_info "Running clippy..."
    cargo clippy -- -D warnings

    print_info "Checking format..."
    cargo fmt -- --check

    print_success "All checks passed"
}

# Format code
format_code() {
    print_info "Formatting Rust code..."
    cd "$RUST_DIR"
    cargo fmt
    print_success "Code formatted"
}

# Show database info
db_info() {
    local db_path="${1:-$DEFAULT_DB}"
    local found=0

    # Show development database info
    if [ -f "$db_path" ]; then
        print_info "Development database: $db_path"
        local size=$(du -h "$db_path" | cut -f1)
        echo "  Size: $size"
        echo "  Modified: $(stat -f '%Sm' -t '%Y-%m-%d %H:%M:%S' "$db_path" 2>/dev/null || stat -c '%y' "$db_path" 2>/dev/null | cut -d'.' -f1)"
        found=1
        echo ""
    else
        print_info "Development database not found: $db_path"
        echo ""
    fi

    # Show Tauri app database info
    local app_data_dir=$(get_app_data_dir)
    if [ $? -eq 0 ]; then
        local app_db_path="$app_data_dir/per-ankh.db"
        if [ -f "$app_db_path" ]; then
            print_info "Tauri app database: $app_db_path"
            local size=$(du -h "$app_db_path" | cut -f1)
            echo "  Size: $size"
            echo "  Modified: $(stat -f '%Sm' -t '%Y-%m-%d %H:%M:%S' "$app_db_path" 2>/dev/null || stat -c '%y' "$app_db_path" 2>/dev/null | cut -d'.' -f1)"
            found=1
        else
            print_info "Tauri app database not found: $app_db_path"
        fi
    fi

    if [ $found -eq 0 ]; then
        print_warning "No databases found"
        exit 1
    fi
}

# Display help
show_help() {
    cat << EOF
Per-Ankh Development Helper Script

Usage: $0 <command> [options]

Commands:
  import <file> [db]           Import a single save file
                               Example: $0 import test-data/saves/OW-Greece-Year74.zip

  import-all [dir] [db] [pat]  Import all saves from directory (default: test-data/saves)
                               Example: $0 import-all
                               Example: $0 import-all ./my-saves custom.db "OW-Greece*.zip"

  clean [db]                   Remove database files (dev + Tauri app databases)
                               Example: $0 clean

  dev                          Run the application in development mode
                               Example: $0 dev

  build                        Build application for distribution
                               Example: $0 build

  test [name]                  Run Rust tests (optionally filter by name)
                               Example: $0 test
                               Example: $0 test test_import

  test-release [name]          Run Rust tests in release mode
                               Example: $0 test-release

  check                        Run code quality checks (cargo check, clippy, fmt)
                               Example: $0 check

  format                       Format Rust code
                               Example: $0 format

  db-info [db]                 Show database information (dev + Tauri app databases)
                               Example: $0 db-info

  help                         Show this help message

Options:
  db                           Database file path (default: per-ankh.db)
  dir                          Directory containing save files (default: test-data/saves)
  pat                          File pattern to match (default: *.zip)

Examples:
  # Import a single save file
  $0 import test-data/saves/OW-Greece-Year74-2022-01-02-20-28-07.zip

  # Import all test saves
  $0 import-all

  # Import all Greece saves only
  $0 import-all test-data/saves per-ankh.db "OW-Greece*.zip"

  # Remove database and reimport all saves
  $0 clean && $0 import-all

  # Run the app
  $0 dev

  # Build for distribution
  $0 build

  # Run tests
  $0 test

EOF
}

# Main command dispatcher
main() {
    if [ $# -eq 0 ]; then
        show_help
        exit 1
    fi

    local command="$1"
    shift

    case "$command" in
        import)
            check_requirements
            import_save "$@"
            ;;
        import-all)
            check_requirements
            import_all "$@"
            ;;
        clean)
            clean_db "$@"
            ;;
        dev)
            check_requirements
            run_dev
            ;;
        build)
            check_requirements
            build_app
            ;;
        test)
            check_requirements
            run_tests "$@"
            ;;
        test-release)
            check_requirements
            run_tests_release "$@"
            ;;
        check)
            check_requirements
            check_code
            ;;
        format)
            check_requirements
            format_code
            ;;
        db-info)
            db_info "$@"
            ;;
        help|--help|-h)
            show_help
            ;;
        *)
            print_error "Unknown command: $command"
            echo ""
            show_help
            exit 1
            ;;
    esac
}

# Run main function with all arguments
main "$@"
