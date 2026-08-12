#!/bin/sh
set -eu
if [ "$#" -ne 1 ]; then printf 'usage: %s <legacy-env-file>\n' "$0" >&2; exit 2; fi
legacy_env=$1
config_dir=${XDG_CONFIG_HOME:-$HOME/.config}/queqiao
data_dir=${XDG_DATA_HOME:-$HOME/.local/share}/queqiao
secrets_dir=$data_dir/secrets
mkdir -p -m 700 "$config_dir" "$data_dir" "$secrets_dir"
chmod 700 "$config_dir" "$data_dir" "$secrets_dir"
token=$(sed -n 's/^QUEQIAO_WORKER_TOKEN=//p' "$legacy_env" | head -n 1)
test -n "$token"
umask 077
printf '%s\n' "$token" > "$secrets_dir/worker-token.secret"
printf 'QUEQIAO_WORKER_PORT=7577\nQUEQIAO_ENVIRONMENT_ID=wsl\nQUEQIAO_WORKSPACE_ID=irispipe\nQUEQIAO_WORKSPACES_FILE=%s\nQUEQIAO_WORKER_TOKEN_FILE=%s\n' "$config_dir/workspaces.json" "$secrets_dir/worker-token.secret" > "$config_dir/runtime.env"
chmod 600 "$config_dir/runtime.env" "$secrets_dir/worker-token.secret" "$config_dir/workspaces.json"
for item in "$config_dir" "$data_dir" "$secrets_dir" "$config_dir/runtime.env" "$secrets_dir/worker-token.secret" "$config_dir/workspaces.json"; do stat -c '%a %n' "$item"; done
