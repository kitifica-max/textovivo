# Convierte fuentes/gracian/wikisource.raw (Wikisource en español) en páginas: una página por aforismo.
# Uso: python3 -I scripts/gracian-wikisource.py
import json, os, re
raw = open("fuentes/gracian/wikisource.raw", encoding="utf8").read()
paginas = {}
for bloque in raw.split("\n\n#####\n"):
    titulo, _, cuerpo = bloque.partition("\n")
    if "Aforismos" not in titulo:
        continue
    cuerpo = re.sub(r"\{\{encabezado.*?\n\}\}", "", cuerpo, flags=re.S)
    cuerpo = re.sub(r"\{\{[^}]*\}\}", "", cuerpo).replace("''", "")
    cuerpo = re.sub(r"\[\[(?:[^\]|]*\|)?([^\]]*)\]\]", r"\1", cuerpo)
    for p in re.split(r"\n\s*\n", cuerpo):
        p = re.sub(r"\s+", " ", p).strip()
        m = re.match(r"^(\d{1,3})\. (.+)$", p)
        if m:
            paginas[int(m.group(1))] = m.group(2)
assert sorted(paginas) == list(range(1, 301)), sorted(set(range(1, 301)) - set(paginas))
os.makedirs("data/libros/gracian", exist_ok=True)
json.dump([{"pagina": n, "texto": f"{n}. {paginas[n]}"} for n in range(1, 301)], open("data/libros/gracian/paginas.json", "w"), ensure_ascii=False)
indice = [{"titulo": f"Aforismos {a}-{min(a + 24, 300)}", "nivel": 1, "pagina_inicio": a, "pagina_fin": min(a + 24, 300)} for a in range(1, 301, 25)]
json.dump(indice, open("data/libros/gracian/indice.json", "w"), ensure_ascii=False, indent=1)
json.dump({"titulo": "Oráculo manual y arte de prudencia", "autor": "Baltasar Gracián", "descripcion": "300 aforismos sobre cómo actuar con prudencia, ganar voluntades y conducirse en el mundo. Cada página es un aforismo.", "idioma": "es", "publicar": True}, open("data/libros/gracian/meta.json", "w"), ensure_ascii=False, indent=1)
print("gracian: 300 aforismos")
