#!/usr/bin/env bash
# Whether a sandboxed local Codex can run the aeolus plugin's fleet scripts
# after a one-time setup (#104): with the workspace-write sandbox, network
# access on and the plugin's data folder writable, a command the model runs
# reaches the fleet's REST API and writes in the plugin's data folder, without
# an approval prompt.
#
#   scripts/codex-sandbox-probe.sh [<fleetUrl>]
#
# The setup is passed with -c for this run only; ~/.codex is not changed. The
# fleet is asked whoami with a made-up crew token, so it answers 401 and no
# secret is used. Prints PROBE PASS, or PROBE FAIL with the reason.
# AEOLUS_PROBE_KEEP=1 keeps the workspace, with Codex's log, for a look after.
set -uo pipefail

fleet_url="${1:-https://fleet.aeolus-fleet.dev}"
fleet_url="${fleet_url%/}"
data="${CODEX_HOME:-$HOME/.codex}/plugins/data/aeolus-aeolus-fleet"

fail() {
  echo "PROBE FAIL: $1"
  exit 1
}

command -v codex >/dev/null 2>&1 || fail "codex is not installed"

workspace="$(mktemp -d)" || fail "no temporary folder"
# The highest folder this probe creates, so it removes only what it made.
created=""
missing="$data"
while [ ! -d "$missing" ]; do
  created="$missing"
  missing="$(dirname "$missing")"
done
probe_dir="$data/sandbox-probe-$$"
mkdir -p "$probe_dir" || fail "cannot create $probe_dir"
cleanup() {
  [ -n "${AEOLUS_PROBE_KEEP:-}" ] && echo "kept $workspace" >&2 || rm -rf "$workspace"
  rm -rf "$probe_dir"
  if [ -n "$created" ]; then
    folder="$data"
    while rmdir "$folder" 2>/dev/null && [ "$folder" != "$created" ]; do
      folder="$(dirname "$folder")"
    done
  fi
  return 0
}
trap cleanup EXIT

# What the model runs: one curl and one write, their outcomes into the
# workspace, which the sandbox lets it write.
cat > "$workspace/probe.sh" <<EOF
#!/usr/bin/env bash
status="\$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 '$fleet_url/api/v1/ship/whoami' -H 'authorization: Bearer aeolus_ct_v1_sandbox_probe' 2>"$workspace/curl.err")"
printf 'http=%s\n' "\$status" > "$workspace/result.txt"
if printf 'probe\n' > '$probe_dir/written' 2>"$workspace/write.err"; then
  echo 'write=ok' >> "$workspace/result.txt"
else
  echo 'write=refused' >> "$workspace/result.txt"
fi
EOF

codex exec \
  --ephemeral --ignore-rules --skip-git-repo-check \
  -C "$workspace" \
  -s workspace-write \
  -c approval_policy='"never"' \
  -c sandbox_workspace_write.network_access=true \
  -c "sandbox_workspace_write.writable_roots=[\"$data\"]" \
  "Run exactly this shell command once and answer with its output and errors verbatim, nothing else: bash $workspace/probe.sh" \
  </dev/null >"$workspace/codex.log" 2>&1
codex_status=$?

if [ ! -f "$workspace/result.txt" ]; then
  reason="Codex (exit $codex_status) did not run the command in its sandbox"
  sandbox_error="$(grep -v -E '^(sandbox|warning):' "$workspace/codex.log" | grep -m 1 -i -E 'bwrap|sandbox|seatbelt|denied|not permitted')"
  [ -n "$sandbox_error" ] && reason="$reason: $sandbox_error"
  fail "$reason"
fi

http="$(sed -n 's/^http=//p' "$workspace/result.txt")"
write="$(sed -n 's/^write=//p' "$workspace/result.txt")"
[ "$http" = 401 ] || fail "the fleet was not reached from the sandbox (HTTP ${http:-none}: $(head -c 300 "$workspace/curl.err"))"
[ "$write" = ok ] && [ -f "$probe_dir/written" ] || fail "the sandbox refused a write in $data ($(head -c 300 "$workspace/write.err"))"

echo "PROBE PASS: the sandboxed command reached $fleet_url (HTTP 401 for a made-up token) and wrote in $data, with network_access and writable_roots set for this run only"
