#!/bin/sh
# Despliega el Worker y vuelve a subir ADMIN_SECRET (.secreto-admin), TURNSTILE_SECRET (.secreto-turnstile) y RESEND_API_KEY (.secreto-resend).
# Sin esto, `wrangler deploy` deja el Worker sin el secreto y /admin/* responde 401.
set -e
cd "$(dirname "$0")/.."
tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT
printf 'ADMIN_SECRET=%s\n' "$(tr -d '\n' < .secreto-admin)" > "$tmp"
# Turnstile: la clave secreta del widget real va en .secreto-turnstile. Sin ese archivo se usa la de PRUEBA (siempre aprueba).
if [ -s .secreto-turnstile ]; then
  printf 'TURNSTILE_SECRET=%s\n' "$(tr -d '\n' < .secreto-turnstile)" >> "$tmp"
else
  echo "AVISO: sin .secreto-turnstile; se usa la clave de PRUEBA de Turnstile (no protege)." >&2
  printf 'TURNSTILE_SECRET=1x0000000000000000000000000000000AA\n' >> "$tmp"
fi
# Resend: clave de envío (solo kitifica.com) en .secreto-resend. Sin ese archivo no salen correos.
if [ -s .secreto-resend ]; then
  printf 'RESEND_API_KEY=%s\n' "$(tr -d '\n' < .secreto-resend)" >> "$tmp"
else
  echo "AVISO: sin .secreto-resend; el Worker no podrá enviar correos de confirmación." >&2
fi
npx wrangler deploy --secrets-file "$tmp" "$@"
