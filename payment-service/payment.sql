CREATE TABLE IF NOT EXISTS payment (
  order_id     TEXT PRIMARY KEY,
  amount_cents INTEGER NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('AUTHORIZED', 'REJECTED', 'VOIDED')),
  reason       TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS outbox (
  id           UUID PRIMARY KEY,
  topic        TEXT NOT NULL,
  msg_key      TEXT NOT NULL,
  payload      JSONB NOT NULL,
  traceparent  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS outbox_pending ON outbox (created_at) WHERE published_at IS NULL;
