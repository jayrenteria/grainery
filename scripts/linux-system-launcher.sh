#!/usr/bin/env bash
set -e

launcher_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
export GRAINERY_DISTRIBUTION=linux-system
exec "$launcher_dir/grainery-bin" "$@"
