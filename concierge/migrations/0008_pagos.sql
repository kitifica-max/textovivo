-- Cobro con Wompi: pagos únicos de 30 días (sin suscripción) y vencimiento del plan.
ALTER TABLE users ADD COLUMN plan_vence_at TEXT;                   -- NULL con un plan distinto de «gratis» = sin vencimiento (otorgado a mano)
ALTER TABLE users ADD COLUMN plan_aviso INTEGER NOT NULL DEFAULT 0; -- 0 ninguno · 1 aviso de 7 días enviado · 2 aviso de 1 día enviado

CREATE TABLE pagos (
  id TEXT PRIMARY KEY,                                  -- va a Wompi como identificadorEnlaceComercio
  user_id TEXT NOT NULL REFERENCES users(id),
  producto TEXT NOT NULL,
  monto REAL NOT NULL,
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'aprobado')),
  enlace_id TEXT,
  enlace_url TEXT,
  transaccion_id TEXT UNIQUE,                           -- una transacción de Wompi solo puede activar un pago
  modo TEXT NOT NULL,                                   -- pruebas | produccion
  created_at TEXT NOT NULL,
  aprobado_at TEXT
);
CREATE INDEX pagos_user ON pagos(user_id, created_at);
