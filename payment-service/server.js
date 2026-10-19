const express = require('express');
const { Pool } = require('pg');
const log = require('./logger');
const { httpMetrics, metricsEndpoint } = require('./metrics');
const { onCommand } = require('./payments');
const { startRelay } = require('./relay');
const { consume } = require('./kafka-consumer');

const app = express();
app.use(express.json());
app.use(httpMetrics);

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_DATABASE_NAME,
  user: process.env.DB_DATABASE_USER,
  password: process.env.DB_DATABASE_PASSWORD,
});

let consumerReady = false;

async function ensureSchema() {
  await pool.query(`
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
  `);
}

app.get('/health/live', (req, res) => res.status(200).json({ status: 'ok' }));

app.get(['/health/ready', '/health'], async (req, res) => {
  try {
    await pool.query('SELECT 1');
    if (!consumerReady) {
      return res.status(503).json({ status: 'not ready', reason: 'consumer non avviato' });
    }
    res.status(200).json({ status: 'ready' });
  } catch (err) {
    log.warn({ error: err.message }, 'non pronto: database non raggiungibile');
    res.status(503).json({ status: 'not ready' });
  }
});

app.get('/payments/:orderId', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM payment WHERE order_id = $1', [req.params.orderId]);
    if (rows.length === 0) return res.status(404).json({ error: 'pagamento non trovato' });
    res.json(rows[0]);
  } catch (err) {
    log.error({ error: err.message }, 'lettura pagamento non riuscita');
    res.status(500).json({ error: err.message });
  }
});

app.get('/metrics', metricsEndpoint);

const PORT = process.env.PORT || 8080;

async function main() {
  for (;;) {
    try {
      await ensureSchema();
      break;
    } catch (err) {
      log.warn({ error: err.message }, 'database non pronto, riprovo');
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  log.info({
    db_host: process.env.DB_HOST,
    kafka: process.env.KAFKA_BOOTSTRAP,
    group: process.env.KAFKA_GROUP,
    limit_cents: process.env.PAYMENT_LIMIT_CENTS,
    delay_ms: process.env.PAYMENT_DELAY_MS,
  }, 'payment-service avviato');

  startRelay(pool);
  consume({
    topic: 'payment.commands',
    groupId: process.env.KAFKA_GROUP || 'payment-service',
    dlqTopic: 'payment.dlq',
    pool,
    handler: onCommand,
    onReady: () => { consumerReady = true; },
  }).catch((err) => {
    log.error({ error: err.message }, 'consumer: avvio fallito');
    process.exit(1);
  });

  app.listen(PORT, '0.0.0.0', () => {
    log.info({ port: PORT }, 'payment-service in ascolto');
  });
}

main();
