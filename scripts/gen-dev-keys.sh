#!/usr/bin/env bash
#
# Generate a DEV-ONLY RS256 keypair for the Identity service if it is missing.
#
# These keys are GIT-IGNORED and regenerated on demand (CI + local + bootstrap).
# They sign ONLY demo JWTs and protect nothing — we deliberately do NOT commit a
# private key to the repo. Production injects its own keypair via
# JWT_PRIVATE_KEY(_PATH) / JWT_PUBLIC_KEY(_PATH) (see apps/identity/README.md),
# and the Identity service refuses to boot in production without it.
#
# Idempotent: if a matched pair already exists it does nothing. If either file is
# missing it regenerates BOTH so the private/public pair always matches.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KEYS_DIR="$ROOT/apps/identity/keys"
mkdir -p "$KEYS_DIR"

if [ -f "$KEYS_DIR/dev-private.pem" ] && [ -f "$KEYS_DIR/dev-public.pem" ]; then
  echo "[gen-dev-keys] dev keypair already present — skipping"
  exit 0
fi

echo "[gen-dev-keys] generating dev RS256 keypair in apps/identity/keys"
node -e '
const { generateKeyPairSync } = require("node:crypto");
const fs = require("node:fs");
const dir = process.argv[1];
const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
fs.writeFileSync(dir + "/dev-private.pem", privateKey.export({ type: "pkcs8", format: "pem" }));
fs.writeFileSync(dir + "/dev-public.pem", publicKey.export({ type: "spki", format: "pem" }));
' "$KEYS_DIR"
echo "[gen-dev-keys] done"
