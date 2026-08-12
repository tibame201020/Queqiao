#!/bin/sh
set -eu

project_root=${QUEQIAO_PROJECT_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}
exec node "$project_root/dist/queqiao-worker.js"
