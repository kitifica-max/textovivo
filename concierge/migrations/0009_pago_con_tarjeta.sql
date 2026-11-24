-- Pago con formulario propio (transacción 3DS): intentos por pago. La tarjeta nunca se guarda.
ALTER TABLE pagos ADD COLUMN intentos INTEGER NOT NULL DEFAULT 0;
