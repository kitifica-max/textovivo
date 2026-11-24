-- Revisión automática de aportes públicos: qué encontró y quién aprobó.
ALTER TABLE envios ADD COLUMN veredicto TEXT;        -- auto_ok | revision | bloqueado (lo que decidieron las reglas y la IA)
ALTER TABLE envios ADD COLUMN puntaje INTEGER;       -- suma de gravedades: alta = 5, media = 2
ALTER TABLE envios ADD COLUMN motivos TEXT;          -- JSON: [{codigo, gravedad, detalle}]
ALTER TABLE envios ADD COLUMN evaluado_at TEXT;
ALTER TABLE envios ADD COLUMN texto_hash TEXT;       -- huella del texto, para detectar envíos repetidos
ALTER TABLE envios ADD COLUMN aprobado_por TEXT;     -- auto | manual
CREATE INDEX envios_hash ON envios(texto_hash);
