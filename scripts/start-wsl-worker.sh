#!/bin/sh
set -eu

project_root=${QUEQIAO_PROJECT_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}
environment_file=${QUEQIAO_ENV_FILE:-"$project_root/.env"}
QUEQIAO_WORKER_TOKEN=$(sed -n 's/^QUEQIAO_WORKER_TOKEN=//p' "$environment_file" | head -n 1)
: "${QUEQIAO_WORKER_TOKEN:?QUEQIAO_WORKER_TOKEN is missing from .env}"
export QUEQIAO_WORKER_TOKEN

export QUEQIAO_WORKER_PORT=7577
export QUEQIAO_ENVIRONMENT_ID=wsl
export QUEQIAO_WORKSPACE_ID=${QUEQIAO_WORKSPACE_ID:-irispipe}
export QUEQIAO_WORKSPACES_FILE=${QUEQIAO_WORKSPACES_FILE:-"${XDG_CONFIG_HOME:-$HOME/.config}/queqiao/workspaces.json"}

exec node "$project_root/apps/worker/dist/index.js"
