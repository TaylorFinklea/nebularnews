#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  scripts/sync-gh-secrets.sh [--repo owner/name]

Reads deployment secret values from current shell environment and writes them
to GitHub repository secrets used by the Cloudflare deploy workflow.

Required environment variables:
  CLOUDFLARE_API_TOKEN
  CLOUDFLARE_ACCOUNT_ID
  PRODUCTION_BASE_URL

Optional:
  STAGING_BASE_URL
  GITHUB_REPOSITORY (owner/name; used when --repo is not passed)
EOF
}

REPO="${GITHUB_REPOSITORY:-}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo)
      if [[ $# -lt 2 ]]; then
        echo "Missing value for --repo" >&2
        exit 1
      fi
      REPO="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if ! command -v gh >/dev/null 2>&1; then
  echo "GitHub CLI (gh) is required." >&2
  exit 1
fi

gh auth status >/dev/null

if [[ -z "$REPO" ]]; then
  REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner)"
fi

require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required environment variable: $name" >&2
    exit 1
  fi
}

set_secret() {
  local name="$1"
  local value="$2"
  gh secret set "$name" --repo "$REPO" --body "$value" >/dev/null
  echo "Set GitHub secret: $name"
}

require_env "CLOUDFLARE_API_TOKEN"
require_env "CLOUDFLARE_ACCOUNT_ID"
require_env "PRODUCTION_BASE_URL"

set_secret "CLOUDFLARE_API_TOKEN" "$CLOUDFLARE_API_TOKEN"
set_secret "CLOUDFLARE_ACCOUNT_ID" "$CLOUDFLARE_ACCOUNT_ID"
set_secret "PRODUCTION_BASE_URL" "$PRODUCTION_BASE_URL"

if [[ -n "${STAGING_BASE_URL:-}" ]]; then
  set_secret "STAGING_BASE_URL" "$STAGING_BASE_URL"
else
  echo "Skipping optional secret: STAGING_BASE_URL (not set)"
fi

echo "GitHub deploy secrets synced for repo: $REPO"
