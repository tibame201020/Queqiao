#!/bin/sh
set -eu

tarball=$(realpath "$1")
test_root=$(mktemp -d)
worker_pid=
gateway_pid=
cleanup() {
  status=$?
  if [ "$status" -ne 0 ]; then
    printf '%s\n' '--- Worker log ---' >&2
    cat "$test_root/worker.log" >&2 2>/dev/null || true
    printf '%s\n' '--- Gateway log ---' >&2
    cat "$test_root/gateway.log" >&2 2>/dev/null || true
  fi
  [ -z "$gateway_pid" ] || kill "$gateway_pid" 2>/dev/null || true
  [ -z "$worker_pid" ] || kill "$worker_pid" 2>/dev/null || true
  rm -rf "$test_root"
  trap - EXIT INT TERM
  exit "$status"
}
trap cleanup EXIT INT TERM

npm install --prefix "$test_root/install" "$tarball" --ignore-scripts >/dev/null
mkdir -p "$test_root/home/.config/queqiao" "$test_root/data/secrets" "$test_root/data/gateway" "$test_root/workspace"
printf '%s\n' 'approval-secret-for-linux-integration' > "$test_root/data/secrets/approval.secret"
printf '%s\n' 'jwt-signing-secret-for-linux-integration-at-least-32-bytes' > "$test_root/data/secrets/jwt.secret"
printf '%s\n' 'worker-token-for-linux-integration-at-least-32-bytes' > "$test_root/data/secrets/worker.secret"
printf '%s\n' 'linux package integration' > "$test_root/workspace/fixture.txt"
cat > "$test_root/home/.config/queqiao/config.yaml" <<EOF
version: 1
gateway:
  publicBaseUrl: http://127.0.0.1:17575/
  listen: { host: 127.0.0.1, port: 17575 }
  trustProxyHops: 0
  stateDirectory: $test_root/data/gateway
  approvalSecretFile: $test_root/data/secrets/approval.secret
  jwtSigningSecretFile: $test_root/data/secrets/jwt.secret
worker:
  environmentId: linux-ci
  listen: { host: 127.0.0.1, port: 17576 }
  tokenFile: $test_root/data/secrets/worker.secret
  defaultWorkspaceId: fixture
environments:
  - environmentId: linux-ci
    url: http://127.0.0.1:17576
    tokenFile: $test_root/data/secrets/worker.secret
workspaces:
  - id: fixture
    displayName: Fixture
    root: $test_root/workspace
    profile: read-only
EOF

config_file="$test_root/home/.config/queqiao/config.yaml"
QUEQIAO_CONFIG_FILE="$config_file" "$test_root/install/node_modules/.bin/queqiao-worker" >"$test_root/worker.log" 2>&1 & worker_pid=$!
QUEQIAO_CONFIG_FILE="$config_file" "$test_root/install/node_modules/.bin/queqiao-gateway" >"$test_root/gateway.log" 2>&1 & gateway_pid=$!
health=
for attempt in $(seq 1 120); do
  kill -0 "$worker_pid" 2>/dev/null || exit 1
  kill -0 "$gateway_pid" 2>/dev/null || exit 1
  health=$(curl -fsS http://127.0.0.1:17575/health 2>/dev/null || true)
  echo "$health" | grep -q '"reachable":true' && break
  sleep 0.5
done
echo "$health" | grep -q '"environmentId":"linux-ci"'
echo "$health" | grep -q '"reachable":true'
hello=$(curl -fsS -H 'x-queqiao-worker-token: worker-token-for-linux-integration-at-least-32-bytes' http://127.0.0.1:17576/v1/hello)
echo "$hello" | grep -q '"protocolVersion":"2.0"'
echo "$hello" | grep -q '"platform":"linux"'
echo "$hello" | grep -q '"workspace-routing"'
echo "$hello" | grep -q '"async-process-v1"'
test "$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:17576/v1/hello)" = 401
printf '%s\n' 'Linux package, Gateway, Worker, and authenticated handshake verified.'
