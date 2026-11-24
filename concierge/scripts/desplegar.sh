#!/bin/sh
# Despliega el Worker y vuelve a subir ADMIN_SECRET desde .secreto-admin.
# Sin esto, `wrangler deploy` deja el Worker sin el secreto y /admin/* responde 401.
set -e
cd "$(dirname "$0")/.."
tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT
printf 'ADMIN_SECRET=%s\n' "$(tr -d '\n' < .secreto-admin)" > "$tmp"
npx wrangler deploy --secrets-file "$tmp" "$@"
