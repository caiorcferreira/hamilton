#!/usr/bin/env bash
set -euo pipefail

package_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
repository_root="$(cd "$package_dir/../.." && pwd)"
temporary_directory="$(mktemp -d)"
trap 'rm -rf "$temporary_directory"' EXIT
archive="$temporary_directory/kepler-core.tgz"
consumer="$temporary_directory/consumer"
smoke_home="$temporary_directory/runtime-home"
smoke_config="$temporary_directory/runtime-config"

rm -rf "$package_dir/dist"
(cd "$package_dir" && bun pm pack --filename "$archive" --quiet)
mkdir -p "$consumer"
printf '%s\n' '{"name":"kepler-core-package-smoke","private":true,"type":"module"}' > "$consumer/package.json"
(cd "$consumer" && bun add "file:$archive")
cat > "$consumer/index.ts" <<'EOF'
import {
  KeplerService,
  parseKeplerSettings,
  type KeplerServiceOptions,
  type KeplerSettings,
} from "@vialactea-works/kepler-core";

const options: KeplerServiceOptions = { homeDirectory: "." };
const service = new KeplerService(options);
const settings: KeplerSettings = parseKeplerSettings("enabled: true");
const paths = service.globalPaths();
if (settings.enabled !== true || paths.home.length === 0) throw new Error("Invalid package API");
EOF
cat > "$consumer/tsconfig.json" <<'EOF'
{
  "compilerOptions": {
    "noEmit": true,
    "target": "ES2024",
    "module": "Node16",
    "moduleResolution": "Node16",
    "strict": true,
    "types": []
  },
  "files": ["index.ts"]
}
EOF
"$repository_root/node_modules/.bin/tsc" --project "$consumer/tsconfig.json"
(cd "$consumer" && KEPLER_SMOKE_HOME="$smoke_home" KEPLER_SMOKE_CONFIG="$smoke_config" bun --bun -e 'import * as Path from "node:path"; import { KeplerService, parseKeplerSettings } from "@vialactea-works/kepler-core"; const home = process.env.KEPLER_SMOKE_HOME; const config = process.env.KEPLER_SMOKE_CONFIG; if (!home || !config) process.exit(2); const paths = new KeplerService({ homeDirectory: home, xdgConfigHome: config }).globalPaths(); if (paths.home !== Path.join(config, "vialactea-works", "kepler") || parseKeplerSettings("enabled: true").enabled !== true) process.exit(1); console.log("Packed ESM import and declaration typecheck passed")')
