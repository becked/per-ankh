#!/bin/bash

# Dev server management script for per-ankh
# Usage: ./dev.sh [start|stop|restart|status|logs|release]

set -e

PORT=1420
APP_NAME="per-ankh"
APP_PATTERN="target/debug/per-ankh"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="$SCRIPT_DIR/logs"
LOG_FILE="$LOG_DIR/dev.log"

# Get all related PIDs (Vite on port + app binary)
get_all_pids() {
    {
        lsof -ti:$PORT 2>/dev/null
        pgrep -f "$APP_PATTERN" 2>/dev/null
    } | sort -u
}

# Get first PID for display
get_pid() {
    local pid=$(get_all_pids | head -1)
    if [ -n "$pid" ]; then
        echo "$pid"
        return 0
    fi
    return 1
}

do_status() {
    local pids=$(get_all_pids)
    if [ -n "$pids" ]; then
        echo "$APP_NAME is running (PIDs: $(echo $pids | tr '\n' ' '))"
        return 0
    else
        echo "$APP_NAME is not running"
        return 1
    fi
}

do_stop() {
    local pids=$(get_all_pids)
    if [ -n "$pids" ]; then
        echo "Stopping $APP_NAME (PIDs: $(echo $pids | tr '\n' ' '))..."
        echo "$pids" | xargs kill 2>/dev/null || true
        sleep 1
        # Force kill if still running
        local remaining=$(get_all_pids)
        if [ -n "$remaining" ]; then
            echo "$remaining" | xargs kill -9 2>/dev/null || true
        fi
        echo "Stopped"
    else
        echo "$APP_NAME is not running"
    fi
}

do_start() {
    if get_pid > /dev/null 2>&1; then
        echo "$APP_NAME is already running (PID: $(get_pid))"
        return 1
    fi

    # Ensure log directory exists
    mkdir -p "$LOG_DIR"

    echo "Starting $APP_NAME..."
    echo "--- Started at $(date) ---" >> "$LOG_FILE"
    cd "$SCRIPT_DIR" && npm run tauri:dev >> "$LOG_FILE" 2>&1 &

    # Wait for app to be ready
    for i in {1..30}; do
        if get_pid > /dev/null 2>&1; then
            echo "$APP_NAME started (PID: $(get_pid))"
            echo "Logs: $LOG_FILE"
            return 0
        fi
        sleep 1
    done

    echo "Warning: App may not have started properly"
    echo "Check logs: $LOG_FILE"
    return 1
}

do_logs() {
    if [ -f "$LOG_FILE" ]; then
        tail -f "$LOG_FILE"
    else
        echo "No log file found at $LOG_FILE"
        return 1
    fi
}

do_restart() {
    do_stop
    sleep 1
    do_start
}

do_release() {
    local version="$1"
    local force="$2"

    # Validate version argument
    if [ -z "$version" ]; then
        echo "Error: Version required"
        echo "Usage: $0 release <version> [--force]"
        echo "Example: $0 release 0.1.5"
        exit 1
    fi

    # Validate semver format (basic: major.minor.patch)
    if ! [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
        echo "Error: Invalid version format '$version'"
        echo "Expected semver format: X.Y.Z (e.g., 0.1.5)"
        exit 1
    fi

    # Check for clean working tree
    if [ -n "$(git status --porcelain)" ]; then
        echo "Error: Working tree is not clean"
        echo "Please commit or stash your changes before releasing."
        git status --short
        exit 1
    fi

    # Check if tag already exists
    local tag="v$version"
    local tag_exists_local=$(git tag -l "$tag")
    local tag_exists_remote=$(git ls-remote --tags origin "refs/tags/$tag" 2>/dev/null)

    if [ -n "$tag_exists_local" ] || [ -n "$tag_exists_remote" ]; then
        if [ "$force" != "--force" ]; then
            echo "Error: Tag $tag already exists"
            echo "Use --force to delete existing tag and re-release:"
            echo "  $0 release $version --force"
            exit 1
        fi
        echo "Warning: Tag $tag exists and will be replaced (--force)"
    fi

    # Get current versions
    local current_tauri=$(grep '"version":' "$SCRIPT_DIR/src-tauri/tauri.conf.json" | head -1 | sed 's/.*"version": *"\([^"]*\)".*/\1/')
    local current_cargo=$(grep '^version = ' "$SCRIPT_DIR/src-tauri/Cargo.toml" | head -1 | sed 's/version = "\([^"]*\)"/\1/')
    local current_npm=$(grep '"version":' "$SCRIPT_DIR/package.json" | head -1 | sed 's/.*"version": *"\([^"]*\)".*/\1/')

    # Preview changes
    echo ""
    echo "=== Release Preview ==="
    echo ""
    echo "Version changes:"
    echo "  tauri.conf.json:  $current_tauri -> $version"
    echo "  Cargo.toml:       $current_cargo -> $version"
    echo "  package.json:     $current_npm -> $version"
    echo ""
    echo "Actions:"
    echo "  1. Update version in config files (3 files)"
    echo "  2. Update CHANGELOG.md release links"
    echo "  3. Commit: 'chore: bump version to $version'"
    echo "  4. Create and push tag: $tag"
    echo "  5. Push to origin (triggers GitHub release workflow)"
    if [ "$force" = "--force" ] && ([ -n "$tag_exists_local" ] || [ -n "$tag_exists_remote" ]); then
        echo "  [--force] Delete existing tag $tag first"
    fi
    echo ""

    # Confirm
    read -p "Proceed with release? [y/N] " confirm
    if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
        echo "Release cancelled"
        exit 0
    fi

    echo ""
    echo "=== Releasing v$version ==="

    # Delete existing tag if --force
    if [ "$force" = "--force" ]; then
        if [ -n "$tag_exists_local" ]; then
            echo "Deleting local tag $tag..."
            git tag -d "$tag"
        fi
        if [ -n "$tag_exists_remote" ]; then
            echo "Deleting remote tag $tag..."
            git push origin ":refs/tags/$tag"
        fi
    fi

    # Update tauri.conf.json
    echo "Updating tauri.conf.json..."
    sed -i '' "s/\"version\": \"$current_tauri\"/\"version\": \"$version\"/" "$SCRIPT_DIR/src-tauri/tauri.conf.json"

    # Update Cargo.toml (only the package version, not dependency versions)
    echo "Updating Cargo.toml..."
    sed -i '' "s/^version = \"$current_cargo\"/version = \"$version\"/" "$SCRIPT_DIR/src-tauri/Cargo.toml"

    # Update package.json
    echo "Updating package.json..."
    sed -i '' "s/\"version\": \"$current_npm\"/\"version\": \"$version\"/" "$SCRIPT_DIR/package.json"

    # Update CHANGELOG.md links
    echo "Updating CHANGELOG.md links..."
    local changelog="$SCRIPT_DIR/CHANGELOG.md"
    # Extract previous version from [Unreleased] link
    local prev_version=$(grep '^\[Unreleased\]:' "$changelog" | sed 's/.*compare\/v\([0-9.]*\)\.\.\.HEAD/\1/')
    if [ -n "$prev_version" ]; then
        # Update [Unreleased] to compare from new version
        sed -i '' "s|\[Unreleased\]: \(.*\)/compare/v${prev_version}\.\.\.HEAD|[Unreleased]: \1/compare/v${version}...HEAD|" "$changelog"
        # Insert new version link after [Unreleased]
        sed -i '' "/^\[Unreleased\]:/a\\
[${version}]: https://github.com/becked/per-ankh/compare/v${prev_version}...v${version}
" "$changelog"
    else
        echo "Warning: Could not parse previous version from CHANGELOG.md"
    fi

    # Commit changes
    echo "Committing version bump..."
    git add "$SCRIPT_DIR/src-tauri/tauri.conf.json" "$SCRIPT_DIR/src-tauri/Cargo.toml" "$SCRIPT_DIR/package.json" "$SCRIPT_DIR/CHANGELOG.md"
    git commit -m "chore: bump version to $version"

    # Create tag
    echo "Creating tag $tag..."
    git tag "$tag"

    # Push commit and tag
    echo "Pushing to origin..."
    git push origin main
    git push origin "$tag"

    echo ""
    echo "=== Release $tag initiated ==="
    echo "GitHub Actions will now build and create the release."
    echo "Monitor progress: gh run list --limit 3"
}

case "${1:-}" in
    start)
        do_start
        ;;
    stop)
        do_stop
        ;;
    restart)
        do_restart
        ;;
    status)
        do_status
        ;;
    logs)
        do_logs
        ;;
    release)
        do_release "$2" "$3"
        ;;
    *)
        echo "Usage: $0 {start|stop|restart|status|logs|release}"
        echo ""
        echo "Commands:"
        echo "  start    Start the dev server"
        echo "  stop     Stop the dev server"
        echo "  restart  Restart the dev server"
        echo "  status   Show dev server status"
        echo "  logs     Tail the dev server logs"
        echo "  release  Create a new release (e.g., ./dev.sh release 0.1.5)"
        exit 1
        ;;
esac
