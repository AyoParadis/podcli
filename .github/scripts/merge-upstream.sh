#!/usr/bin/env bash

set -euo pipefail

readonly upstream_url="https://github.com/nmbrthirteen/podcli.git"
readonly upstream_branch="main"
readonly upstream_sha="${1:-}"
readonly expected_tree="${2:-}"

if [[ ! "$upstream_sha" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Invalid upstream commit: $upstream_sha" >&2
  exit 2
fi

if [[ ! "$expected_tree" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Invalid expected tree: $expected_tree" >&2
  exit 2
fi

git remote remove upstream-sync 2>/dev/null || true
git remote add upstream-sync "$upstream_url"
git fetch --no-tags upstream-sync \
  "+refs/heads/${upstream_branch}:refs/remotes/upstream-sync/${upstream_branch}"

readonly fetched_sha="$(git rev-parse "refs/remotes/upstream-sync/${upstream_branch}")"
if [[ "$fetched_sha" != "$upstream_sha" ]]; then
  echo "Upstream moved after preparation: expected $upstream_sha, fetched $fetched_sha" >&2
  exit 3
fi

git config user.name "podcrypt-upstream-sync[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git merge --no-ff --no-edit "$upstream_sha"

readonly actual_tree="$(git rev-parse 'HEAD^{tree}')"
if [[ "$actual_tree" != "$expected_tree" ]]; then
  echo "Merged tree mismatch: expected $expected_tree, produced $actual_tree" >&2
  exit 4
fi

