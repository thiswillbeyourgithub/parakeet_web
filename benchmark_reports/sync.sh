#!/usr/bin/env bash
# Two-way, ADD-ONLY sync of this folder (the benchmark reports visitors send
# through the sidebar Benchmark section) with the VPS that collects them.
#
#   ./benchmark_reports/sync.sh            # sync
#   ./benchmark_reports/sync.sh --dry-run  # show what would move, touch nothing
#
# Needs the same VPS_USERNAME / VPS_IP / VPS_PORT environment as deploy.sh.
# VPS_REPO_DIR optionally names the remote checkout (relative to the remote
# home, default docker/parakeet_web); the reports live in its benchmark_reports.
#
# Why this cannot lose a report:
#  - Every report is an immutable file the SERVER named (signaling/server.js
#    writes report-<stamp>-<random>.json with the no-overwrite flag), so the
#    correct merge of two copies is the UNION of their files, and that union
#    is the only thing this script computes.
#  - No --delete in either direction: a file can only ever appear somewhere.
#  - --ignore-existing in both directions: a name already present on the
#    receiving side is never touched, even when the bytes differ.
#  - Only top-level report-*.json files move. This script, notes, subfolders
#    and anything else are ignored both ways.
#  - Pull before push, so the local copy is complete before anything leaves.
#  - Verified afterwards rather than assumed: every local report that existed
#    before the pull is checksummed and re-checked, and the listings of both
#    sides are compared, so the script exits non-zero (and says which names)
#    if either side ends up missing a report the other has.
#
# Built with Claude Code.

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

DRY=()
case "${1:-}" in
  -n|--dry-run) DRY=(--dry-run) ;;
  "") ;;
  *) echo "usage: $0 [-n|--dry-run]" >&2; exit 2 ;;
esac

if [[ -n "${SYNC_LOCAL_REMOTE:-}" ]]; then
  # Test hook (test/unit/benchmark-reports-sync.test.mjs): a local folder
  # stands in for the VPS, so the merge logic runs without ssh.
  REMOTE_DIR=$SYNC_LOCAL_REMOTE
  REMOTE_PREFIX=""
  RSYNC_RSH=()
  remote() { bash -c "$1"; }
  where="$REMOTE_DIR"
else
  : "${VPS_USERNAME:?set VPS_USERNAME, as for deploy.sh}"
  : "${VPS_IP:?set VPS_IP, as for deploy.sh}"
  VPS_PORT=${VPS_PORT:-22}
  REMOTE_DIR=${VPS_REPO_DIR:-docker/parakeet_web}/benchmark_reports
  REMOTE_PREFIX="$VPS_USERNAME@$VPS_IP:"
  RSYNC_RSH=(-e "ssh -p $VPS_PORT")
  remote() { ssh -p "$VPS_PORT" "$VPS_USERNAME@$VPS_IP" -- "$1"; }
  where="$VPS_IP:$REMOTE_DIR"
fi

# One report name per line, sorted, on either side. Only top-level files that
# look like what the server writes.
list_local() { find . -maxdepth 1 -type f -name 'report-*.json' -printf '%f\n' | sort; }
list_remote() {
  remote "cd '$REMOTE_DIR' 2>/dev/null && find . -maxdepth 1 -type f -name 'report-*.json' -printf '%f\\n' | sort; true"
}
count() { if [[ -z "$1" ]]; then echo 0; else printf '%s\n' "$1" | wc -l; fi; }
# Names present in $1 but not in $2 (both newline lists).
missing_from() { comm -23 <(printf '%s\n' "$1" | sed '/^$/d') <(printf '%s\n' "$2" | sed '/^$/d'); }

# Shared rsync policy for both directions. -a keeps the server's mtimes so a
# report still tells when it arrived; -i itemises what moved.
RSYNC=(rsync -a -i --ignore-existing --include='report-*.json' --exclude='*'
       ${DRY[@]+"${DRY[@]}"} ${RSYNC_RSH[@]+"${RSYNC_RSH[@]}"})

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

echo "Syncing benchmark reports with $where ${DRY[*]:+(dry run)}"
remote "mkdir -p '$REMOTE_DIR'"

local_before=$(list_local)
remote_before=$(list_remote)
if [[ -n "$local_before" ]]; then
  printf '%s\n' "$local_before" | xargs -d '\n' sha256sum > "$tmp/local-before.sha256"
fi
echo "  local:  $(count "$local_before") report(s) before"
echo "  remote: $(count "$remote_before") report(s) before"

echo "Pulling (add-only)"
"${RSYNC[@]}" "${REMOTE_PREFIX}${REMOTE_DIR}/" ./
echo "Pushing (add-only)"
"${RSYNC[@]}" ./ "${REMOTE_PREFIX}${REMOTE_DIR}/"

if [[ ${#DRY[@]} -gt 0 ]]; then
  echo "Dry run: nothing was changed on either side."
  exit 0
fi

# Verify, do not assume.
status=0
if [[ -s "$tmp/local-before.sha256" ]] && ! sha256sum --quiet -c "$tmp/local-before.sha256"; then
  echo "ERROR: a local report that existed before the sync has changed" >&2
  status=1
fi
local_after=$(list_local)
remote_after=$(list_remote)
for check in \
  "remote_before:local_after:a report on the VPS did not make it here" \
  "local_after:remote_after:a local report did not make it to the VPS" \
  "remote_before:remote_after:a report VANISHED from the VPS during the sync" \
  "local_before:local_after:a report VANISHED locally during the sync"; do
  IFS=: read -r a b what <<< "$check"
  gone=$(missing_from "${!a}" "${!b}")
  if [[ -n "$gone" ]]; then
    echo "ERROR: $what:" >&2
    printf '  %s\n' $gone >&2
    status=1
  fi
done

pulled=$(( $(count "$local_after") - $(count "$local_before") ))
pushed=$(( $(count "$remote_after") - $(count "$remote_before") ))
echo "Pulled $pulled, pushed $pushed."
echo "  local:  $(count "$local_after") report(s) after"
echo "  remote: $(count "$remote_after") report(s) after"
if [[ $status -ne 0 ]]; then
  echo "SYNC INCOMPLETE: see the errors above; nothing was deleted or overwritten, run again." >&2
fi
exit $status
