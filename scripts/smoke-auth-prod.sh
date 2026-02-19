#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <base-url>"
  echo "Example: $0 https://news.finklea.dev"
  exit 1
fi

BASE_URL="${1%/}"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

run_case() {
  local name="$1"
  local data="$2"
  local expected_status="$3"

  local headers_file="$TMP_DIR/${name}.headers"
  local body_file="$TMP_DIR/${name}.body"

  curl -sS -D "$headers_file" -o "$body_file" \
    -H 'content-type: application/json' \
    -X POST \
    "$BASE_URL/api/auth/login" \
    --data "$data"

  local status
  status="$(awk 'toupper($1) ~ /^HTTP\\// { code=$2 } END { print code }' "$headers_file")"
  local request_id
  request_id="$(awk 'tolower($1) == "x-request-id:" { print $2 }' "$headers_file" | tr -d '\r' | tail -1)"

  echo "[$name] status=$status expected=$expected_status request_id=${request_id:-n/a}"
  echo "[$name] body=$(cat "$body_file")"

  if [[ "$status" != "$expected_status" ]]; then
    echo "[$name] failed"
    exit 1
  fi
}

run_case "wrong-password" '{"password":"wrong-password"}' "401"
run_case "malformed-json" '{' "400"

echo "Auth smoke check passed."
