#!/bin/sh
# Descarga FreeDict eng-spa 2025.11.23 (CC BY-SA 3.0, de WikDict/Wiktionary) a data/diccionario/eng-spa.tei. Una sola vez.
set -e
cd "$(dirname "$0")/.."
URL=https://download.freedict.org/dictionaries/eng-spa/2025.11.23/freedict-eng-spa-2025.11.23.src.tar.xz
SHA=dd724fb48c5701395c15d7d648a9e6f6b75d6ff4269e465dce6d3a292700198d
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
curl -sSL -o "$tmp/d.tar.xz" "$URL"
[ "$(shasum -a 256 "$tmp/d.tar.xz" | cut -d' ' -f1)" = "$SHA" ] || { echo "El archivo no coincide con la suma esperada" >&2; exit 1; }
mkdir -p data/diccionario && tar -xJf "$tmp/d.tar.xz" -C "$tmp" && cp "$tmp/eng-spa/eng-spa.tei" data/diccionario/eng-spa.tei && cp "$tmp/eng-spa/COPYING" data/diccionario/COPYING
echo "Listo: data/diccionario/eng-spa.tei"
