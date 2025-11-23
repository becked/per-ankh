#!/bin/bash

# Dev server management script for per-ankh
# Usage: ./dev.sh [start|stop|restart|status]

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
    *)
        echo "Usage: $0 {start|stop|restart|status|logs}"
        exit 1
        ;;
esac
