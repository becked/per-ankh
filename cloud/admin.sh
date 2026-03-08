#!/bin/bash
# Per-Ankh Cloud Admin CLI
# Manages shared games via wrangler d1/r2 commands directly.
# Requires: wrangler (via npx), jq

set -e

# --- Config ---
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DB_NAME="per-ankh-share-index"
R2_BUCKET="per-ankh-shares"

# --- Colors ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
DIM='\033[2m'
BOLD='\033[1m'
NC='\033[0m'

info()    { echo -e "${BLUE}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[OK]${NC} $1"; }
error()   { echo -e "${RED}[ERROR]${NC} $1" >&2; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $1"; }

# --- Prerequisites ---
check_deps() {
    if ! command -v jq &>/dev/null; then
        error "jq is required. Install with: brew install jq"
        exit 1
    fi
}

# --- D1 helper ---
# Runs a SQL query against remote D1 and returns the results array as JSON.
d1_query() {
    local sql="$1"
    local raw
    raw=$(cd "$SCRIPT_DIR" && npx wrangler d1 execute "$DB_NAME" --remote --command "$sql" --json 2>/dev/null)
    echo "$raw" | jq -r '.[0].results'
}

# --- R2 helper ---
r2_delete() {
    local key="$1"
    cd "$SCRIPT_DIR" && npx wrangler r2 object delete "$R2_BUCKET/$key" --remote 2>/dev/null
}

# --- jq helper ---
# Replaces null or empty string with "—"
JQ_STR='def s: if (. // "" | length) == 0 then "—" else . end;'

# --- Formatting helpers ---
# Pretty-print bytes
fmt_bytes() {
    local bytes=$1
    if [ -z "$bytes" ] || [ "$bytes" = "null" ]; then echo "0 B"; return; fi
    if [ "$bytes" -ge 1048576 ]; then
        echo "$(echo "scale=1; $bytes / 1048576" | bc) MB"
    elif [ "$bytes" -ge 1024 ]; then
        echo "$(echo "scale=1; $bytes / 1024" | bc) KB"
    else
        echo "${bytes} B"
    fi
}

# Truncate string to N chars
trunc() {
    local s="$1" n="$2"
    if [ ${#s} -gt "$n" ]; then
        echo "${s:0:$((n-1))}…"
    else
        echo "$s"
    fi
}

# --- Commands ---

cmd_list() {
    local limit=50
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --limit) limit="$2"; shift 2 ;;
            *) error "Unknown option: $1"; exit 1 ;;
        esac
    done

    info "Listing shares (limit $limit)..."
    local results
    results=$(d1_query "SELECT share_id, game_name, player_nation, total_turns, map_size, blob_size_bytes, created_at FROM shares ORDER BY created_at DESC LIMIT $limit")

    local count
    count=$(echo "$results" | jq 'length')
    if [ "$count" = "0" ]; then
        warn "No shares found."
        return
    fi

    printf "${BOLD}%-22s %-25s %-18s %6s %-10s %8s  %s${NC}\n" \
        "SHARE_ID" "GAME" "NATION" "TURNS" "MAP" "SIZE" "CREATED"
    echo "$results" | jq -r "$JQ_STR"'.[] | [.share_id, (.game_name | s), (.player_nation | s), (.total_turns // 0 | tostring), (.map_size | s), (.blob_size_bytes // 0 | tostring), .created_at] | @tsv' | \
    while IFS=$'\t' read -r id name nation turns map size date; do
        printf "%-22s %-25s %-18s %6s %-10s %8s  %s\n" \
            "$id" "$(trunc "$name" 24)" "$(trunc "$nation" 17)" "$turns" "$(trunc "$map" 9)" "$(fmt_bytes "$size")" "${date:0:16}"
    done
    echo -e "\n${DIM}$count shares shown${NC}"
}

cmd_keys() {
    info "Listing app keys..."
    local results
    results=$(d1_query "SELECT app_key, COUNT(*) as share_count, MAX(created_at) as last_upload FROM shares GROUP BY app_key ORDER BY share_count DESC")

    local count
    count=$(echo "$results" | jq 'length')
    if [ "$count" = "0" ]; then
        warn "No app keys found."
        return
    fi

    printf "${BOLD}%-38s %6s  %s${NC}\n" "APP_KEY" "SHARES" "LAST_UPLOAD"
    echo "$results" | jq -r '.[] | [.app_key, (.share_count | tostring), .last_upload] | @tsv' | \
    while IFS=$'\t' read -r key cnt date; do
        printf "%-38s %6s  %s\n" "$key" "$cnt" "${date:0:16}"
    done
    echo -e "\n${DIM}$count unique keys${NC}"
}

cmd_by_key() {
    local app_key="$1"
    if [ -z "$app_key" ]; then
        error "Usage: admin.sh by-key <app_key>"
        exit 1
    fi

    info "Shares for key: $app_key"
    local results
    results=$(d1_query "SELECT share_id, game_name, player_nation, total_turns, blob_size_bytes, created_at FROM shares WHERE app_key = '$app_key' ORDER BY created_at DESC")

    local count
    count=$(echo "$results" | jq 'length')
    if [ "$count" = "0" ]; then
        warn "No shares found for this key."
        return
    fi

    printf "${BOLD}%-22s %-25s %-18s %6s %8s  %s${NC}\n" \
        "SHARE_ID" "GAME" "NATION" "TURNS" "SIZE" "CREATED"
    echo "$results" | jq -r "$JQ_STR"'.[] | [.share_id, (.game_name | s), (.player_nation | s), (.total_turns // 0 | tostring), (.blob_size_bytes // 0 | tostring), .created_at] | @tsv' | \
    while IFS=$'\t' read -r id name nation turns size date; do
        printf "%-22s %-25s %-18s %6s %8s  %s\n" \
            "$id" "$(trunc "$name" 24)" "$(trunc "$nation" 17)" "$turns" "$(fmt_bytes "$size")" "${date:0:16}"
    done
    echo -e "\n${DIM}$count shares${NC}"
}

cmd_info() {
    local share_id="$1"
    if [ -z "$share_id" ]; then
        error "Usage: admin.sh info <share_id>"
        exit 1
    fi

    local results
    results=$(d1_query "SELECT share_id, app_key, created_at, blob_version, game_name, total_turns, player_nation, map_size, blob_size_bytes FROM shares WHERE share_id = '$share_id'")

    local count
    count=$(echo "$results" | jq 'length')
    if [ "$count" = "0" ]; then
        error "Share not found: $share_id"
        exit 1
    fi

    local row
    row=$(echo "$results" | jq '.[0]')

    local size
    size=$(fmt_bytes "$(echo "$row" | jq -r '.blob_size_bytes')")

    echo ""
    echo -e "${BOLD}Share Details${NC}"
    echo "─────────────────────────────────"
    echo -e "  Share ID:     $(echo "$row" | jq -r '.share_id')"
    echo -e "  App Key:      $(echo "$row" | jq -r '.app_key')"
    echo -e "  Created:      $(echo "$row" | jq -r '.created_at')"
    echo -e "  Version:      $(echo "$row" | jq -r '.blob_version')"
    echo -e "  Game Name:    $(echo "$row" | jq -r "$JQ_STR"'.game_name | s')"
    echo -e "  Turns:        $(echo "$row" | jq -r '.total_turns // "—"')"
    echo -e "  Nation:       $(echo "$row" | jq -r "$JQ_STR"'.player_nation | s')"
    echo -e "  Map Size:     $(echo "$row" | jq -r "$JQ_STR"'.map_size | s')"
    echo -e "  Blob Size:    $size"
    echo -e "  URL:          https://per-ankh.app/share/$share_id"
    echo ""
}

cmd_delete() {
    local share_id="$1"
    if [ -z "$share_id" ]; then
        error "Usage: admin.sh delete <share_id>"
        exit 1
    fi

    # Verify it exists first
    local results
    results=$(d1_query "SELECT share_id, game_name FROM shares WHERE share_id = '$share_id'")
    local count
    count=$(echo "$results" | jq 'length')
    if [ "$count" = "0" ]; then
        error "Share not found: $share_id"
        exit 1
    fi

    local name
    name=$(echo "$results" | jq -r '.[0].game_name // "unnamed"')
    echo -e "${YELLOW}About to delete share ${BOLD}$share_id${NC}${YELLOW} ($name)${NC}"
    echo -n "Are you sure? [y/N] "
    read -r confirm
    if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
        info "Cancelled."
        return
    fi

    info "Deleting from R2..."
    r2_delete "${share_id}.json.gz" || warn "R2 blob not found (may already be deleted)"

    info "Deleting from D1..."
    d1_query "DELETE FROM shares WHERE share_id = '$share_id'" >/dev/null

    success "Share $share_id deleted."
}

cmd_block_key() {
    local app_key="$1"
    local reason="${2:-no reason given}"
    if [ -z "$app_key" ]; then
        error "Usage: admin.sh block-key <app_key> [reason]"
        exit 1
    fi

    d1_query "INSERT INTO blocked_keys (app_key, reason) VALUES ('$app_key', '$reason') ON CONFLICT (app_key) DO UPDATE SET reason = '$reason', blocked_at = datetime('now')" >/dev/null
    success "Blocked key: $app_key ($reason)"
}

cmd_unblock_key() {
    local app_key="$1"
    if [ -z "$app_key" ]; then
        error "Usage: admin.sh unblock-key <app_key>"
        exit 1
    fi

    d1_query "DELETE FROM blocked_keys WHERE app_key = '$app_key'" >/dev/null
    success "Unblocked key: $app_key"
}

cmd_block_ip() {
    local ip="$1"
    local reason="${2:-no reason given}"
    if [ -z "$ip" ]; then
        error "Usage: admin.sh block-ip <ip> [reason]"
        exit 1
    fi

    d1_query "INSERT INTO blocked_ips (ip_address, reason) VALUES ('$ip', '$reason') ON CONFLICT (ip_address) DO UPDATE SET reason = '$reason', blocked_at = datetime('now')" >/dev/null
    success "Blocked IP: $ip ($reason)"
}

cmd_unblock_ip() {
    local ip="$1"
    if [ -z "$ip" ]; then
        error "Usage: admin.sh unblock-ip <ip>"
        exit 1
    fi

    d1_query "DELETE FROM blocked_ips WHERE ip_address = '$ip'" >/dev/null
    success "Unblocked IP: $ip"
}

cmd_blocked() {
    info "Blocked app keys:"
    local keys
    keys=$(d1_query "SELECT app_key, reason, blocked_at FROM blocked_keys ORDER BY blocked_at DESC")

    local key_count
    key_count=$(echo "$keys" | jq 'length')
    if [ "$key_count" = "0" ]; then
        echo "  (none)"
    else
        printf "  ${BOLD}%-38s %-30s %s${NC}\n" "APP_KEY" "REASON" "BLOCKED_AT"
        echo "$keys" | jq -r '.[] | [.app_key, (.reason // "—"), .blocked_at] | @tsv' | \
        while IFS=$'\t' read -r key reason date; do
            printf "  %-38s %-30s %s\n" "$key" "$(trunc "$reason" 29)" "${date:0:16}"
        done
    fi

    echo ""
    info "Blocked IPs:"
    local ips
    ips=$(d1_query "SELECT ip_address, reason, blocked_at FROM blocked_ips ORDER BY blocked_at DESC")

    local ip_count
    ip_count=$(echo "$ips" | jq 'length')
    if [ "$ip_count" = "0" ]; then
        echo "  (none)"
    else
        printf "  ${BOLD}%-18s %-30s %s${NC}\n" "IP" "REASON" "BLOCKED_AT"
        echo "$ips" | jq -r '.[] | [.ip_address, (.reason // "—"), .blocked_at] | @tsv' | \
        while IFS=$'\t' read -r ip reason date; do
            printf "  %-18s %-30s %s\n" "$ip" "$(trunc "$reason" 29)" "${date:0:16}"
        done
    fi
}

cmd_events() {
    local limit=50
    local type_filter=""
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --limit) limit="$2"; shift 2 ;;
            --type)  type_filter="$2"; shift 2 ;;
            *) error "Unknown option: $1"; exit 1 ;;
        esac
    done

    local where=""
    if [ -n "$type_filter" ]; then
        where="WHERE event_type = '$type_filter'"
    fi

    info "Recent events (limit $limit)..."
    local results
    results=$(d1_query "SELECT event_type, share_id, app_key, ip_address, created_at FROM events $where ORDER BY created_at DESC LIMIT $limit")

    local count
    count=$(echo "$results" | jq 'length')
    if [ "$count" = "0" ]; then
        warn "No events found."
        return
    fi

    printf "${BOLD}%-8s %-22s %-38s %-16s %s${NC}\n" "TYPE" "SHARE_ID" "APP_KEY" "IP" "TIME"
    echo "$results" | jq -r '.[] | [.event_type, .share_id, (.app_key // "—"), (.ip_address // "—"), .created_at] | @tsv' | \
    while IFS=$'\t' read -r type id key ip date; do
        printf "%-8s %-22s %-38s %-16s %s\n" "$type" "$id" "$key" "$ip" "${date:0:16}"
    done
    echo -e "\n${DIM}$count events shown${NC}"
}

cmd_stats() {
    info "Fetching stats..."

    local share_stats
    share_stats=$(d1_query "SELECT COUNT(*) as total_shares, COALESCE(SUM(blob_size_bytes), 0) as total_bytes, COUNT(DISTINCT app_key) as unique_keys FROM shares")

    local total
    total=$(echo "$share_stats" | jq -r '.[0].total_shares')
    local bytes
    bytes=$(echo "$share_stats" | jq -r '.[0].total_bytes')
    local keys
    keys=$(echo "$share_stats" | jq -r '.[0].unique_keys')

    local recent_uploads
    recent_uploads=$(d1_query "SELECT COUNT(*) as cnt FROM events WHERE event_type = 'upload' AND created_at > datetime('now', '-1 day')")
    local uploads_24h
    uploads_24h=$(echo "$recent_uploads" | jq -r '.[0].cnt')

    local recent_deletes
    recent_deletes=$(d1_query "SELECT COUNT(*) as cnt FROM events WHERE event_type = 'delete' AND created_at > datetime('now', '-1 day')")
    local deletes_24h
    deletes_24h=$(echo "$recent_deletes" | jq -r '.[0].cnt')

    local blocked_keys
    blocked_keys=$(d1_query "SELECT COUNT(*) as cnt FROM blocked_keys")
    local blocked_key_count
    blocked_key_count=$(echo "$blocked_keys" | jq -r '.[0].cnt')

    local blocked_ips
    blocked_ips=$(d1_query "SELECT COUNT(*) as cnt FROM blocked_ips")
    local blocked_ip_count
    blocked_ip_count=$(echo "$blocked_ips" | jq -r '.[0].cnt')

    echo ""
    echo -e "${BOLD}Per-Ankh Share Stats${NC}"
    echo "─────────────────────────────────"
    echo -e "  Total shares:       $total"
    echo -e "  Total size:         $(fmt_bytes "$bytes")"
    echo -e "  Unique app keys:    $keys"
    echo -e "  Uploads (24h):      $uploads_24h"
    echo -e "  Deletes (24h):      $deletes_24h"
    echo -e "  Blocked keys:       $blocked_key_count"
    echo -e "  Blocked IPs:        $blocked_ip_count"
    echo ""
}

cmd_nuke_key() {
    local app_key="$1"
    local reason="${2:-nuked via admin CLI}"
    if [ -z "$app_key" ]; then
        error "Usage: admin.sh nuke-key <app_key> [reason]"
        exit 1
    fi

    # Get all shares for this key
    local results
    results=$(d1_query "SELECT share_id, game_name FROM shares WHERE app_key = '$app_key'")
    local count
    count=$(echo "$results" | jq 'length')

    echo -e "${RED}${BOLD}NUKE KEY: $app_key${NC}"
    echo -e "This will:"
    echo -e "  1. Block the app key"
    echo -e "  2. Delete all ${BOLD}$count${NC} shares from this key (D1 + R2)"
    echo ""
    echo -n "Type 'nuke' to confirm: "
    read -r confirm
    if [ "$confirm" != "nuke" ]; then
        info "Cancelled."
        return
    fi

    # Block the key
    d1_query "INSERT INTO blocked_keys (app_key, reason) VALUES ('$app_key', '$reason') ON CONFLICT (app_key) DO UPDATE SET reason = '$reason', blocked_at = datetime('now')" >/dev/null
    success "Blocked key: $app_key"

    # Delete each share
    if [ "$count" -gt 0 ]; then
        echo "$results" | jq -r '.[].share_id' | while read -r share_id; do
            info "Deleting $share_id..."
            r2_delete "${share_id}.json.gz" 2>/dev/null || true
            d1_query "DELETE FROM shares WHERE share_id = '$share_id'" >/dev/null
        done
        success "Deleted $count shares."
    else
        info "No shares to delete."
    fi
}

cmd_help() {
    echo -e "${BOLD}Per-Ankh Cloud Admin CLI${NC}"
    echo ""
    echo "Usage: ./admin.sh <command> [options]"
    echo ""
    echo -e "${BOLD}Shares${NC}"
    echo "  list [--limit N]          List all shares (default: 50)"
    echo "  info <share_id>           Show full details for a share"
    echo "  delete <share_id>         Delete a share (D1 + R2)"
    echo ""
    echo -e "${BOLD}App Keys${NC}"
    echo "  keys                      List all app keys with share counts"
    echo "  by-key <app_key>          List shares from a specific app key"
    echo ""
    echo -e "${BOLD}Security${NC}"
    echo "  block-key <key> [reason]  Block an app key"
    echo "  unblock-key <key>         Unblock an app key"
    echo "  block-ip <ip> [reason]    Block an IP address"
    echo "  unblock-ip <ip>           Unblock an IP"
    echo "  blocked                   List all blocked keys and IPs"
    echo "  nuke-key <key> [reason]   Block key + delete ALL its shares"
    echo ""
    echo -e "${BOLD}Monitoring${NC}"
    echo "  events [--type T] [--limit N]  View recent events (type: upload|delete)"
    echo "  stats                     Summary statistics"
    echo ""
    echo -e "${BOLD}Examples${NC}"
    echo "  ./admin.sh list --limit 10"
    echo "  ./admin.sh info V1StGXR8_Z5jdHi6B-myT"
    echo "  ./admin.sh block-ip 1.2.3.4 \"spam uploads\""
    echo "  ./admin.sh nuke-key 550e8400-e29b-41d4-a716-446655440000"
}

# --- Main ---
check_deps

command="${1:-help}"
shift || true

case "$command" in
    list)       cmd_list "$@" ;;
    keys)       cmd_keys ;;
    by-key)     cmd_by_key "$@" ;;
    info)       cmd_info "$@" ;;
    delete)     cmd_delete "$@" ;;
    block-key)  cmd_block_key "$@" ;;
    unblock-key) cmd_unblock_key "$@" ;;
    block-ip)   cmd_block_ip "$@" ;;
    unblock-ip) cmd_unblock_ip "$@" ;;
    blocked)    cmd_blocked ;;
    events)     cmd_events "$@" ;;
    stats)      cmd_stats ;;
    nuke-key)   cmd_nuke_key "$@" ;;
    help|--help|-h) cmd_help ;;
    *)
        error "Unknown command: $command"
        echo ""
        cmd_help
        exit 1
        ;;
esac
