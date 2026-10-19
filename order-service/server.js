const express = require('express');
const { Pool } = require('pg');
const { context, propagation } = require('@opentelemetry/api');
const log = require('./logger');
const { httpMetrics, metricsEndpoint } = require('./metrics');
const catalog = require('./catalog-client');
const { startRelay } = require('./relay');
const { startSaga, onPaymentEvent, expireSagas } = require('./saga');
const { consume } = require('./kafka-consumer');

const app = express();
app.use(express.json());
app.use(httpMetrics);
app.use((req, res, next) => {
  const started = Date.now();
  res.on('finish', () => {
    log.info({
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      duration_ms: Date.now() - started,
    }, 'richiesta');
  });
  next();
});

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_DATABASE_NAME,
  user: process.env.DB_DATABASE_USER,
  password: process.env.DB_DATABASE_PASSWORD,
});

async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS customer_order (
      id            SERIAL PRIMARY KEY,
      customer_id   TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'PLACED',
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      saga_deadline TIMESTAMPTZ,
      cancel_reason TEXT
    );
    ALTER TABLE customer_order ADD COLUMN IF NOT EXISTS saga_deadline TIMESTAMPTZ;
    ALTER TABLE customer_order ADD COLUMN IF NOT EXISTS cancel_reason TEXT;
    CREATE TABLE IF NOT EXISTS order_line (
      order_id         INTEGER REFERENCES customer_order(id),
      product_id       INTEGER NOT NULL,
      product_name     TEXT NOT NULL,
      unit_price_cents INTEGER NOT NULL,
      quantity         INTEGER NOT NULL CHECK (quantity > 0)
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
    ALTER TABLE outbox ADD COLUMN IF NOT EXISTS traceparent TEXT;
    CREATE INDEX IF NOT EXISTS outbox_pending
      ON outbox (created_at) WHERE published_at IS NULL;
    CREATE INDEX IF NOT EXISTS customer_order_saga
      ON customer_order (saga_deadline) WHERE status = 'PAYMENT_PENDING';
  `);
}

async function loadOrder(id) {
  const orderRes = await pool.query('SELECT * FROM customer_order WHERE id = $1', [id]);
  if (orderRes.rows.length === 0) return null;
  const linesRes = await pool.query('SELECT * FROM order_line WHERE order_id = $1', [id]);
  const order = orderRes.rows[0];
  order.lines = linesRes.rows;
  order.total_cents = linesRes.rows.reduce((t, l) => t + l.unit_price_cents * l.quantity, 0);
  return order;
}

function catalogFailure(res, err) {
  if (err instanceof catalog.HttpError && err.status === 404) {
    return res.status(422).json({ error: err.message });
  }
  log.error({
    dependency: 'catalog-service',
    circuit: catalog.circuitState(),
    code: err.code,
    error: err.message,
  }, 'catalogo non disponibile');
  res.set('Retry-After', String(catalog.retryAfterSeconds));
  return res.status(503).json({
    error: 'catalogo momentaneamente non disponibile, riprovare più tardi',
  });
}

app.get('/health/live', (req, res) => res.status(200).json({ status: 'ok' }));

app.get(['/health/ready', '/health'], async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.status(200).json({ status: 'ready' });
  } catch (err) {
    log.warn({ error: err.message }, 'non pronto: database non raggiungibile');
    res.status(503).json({ status: 'not ready' });
  }
});

app.post('/orders', async (req, res) => {
  const { customer_id, lines } = req.body || {};
  if (!customer_id) return res.status(400).json({ error: 'customer_id richiesto' });
  if (!lines || lines.length === 0) {
    return res.status(400).json({ error: 'At least one order line is required' });
  }

  const orderLinesData = [];
  for (const line of lines) {
    if (!line.quantity || line.quantity <= 0) {
      return res.status(400).json({ error: 'Invalid quantity' });
    }
    try {
      const product = await catalog.getProduct(line.product_id);
      orderLinesData.push({
        product_id: product.id,
        product_name: product.name,
        unit_price_cents: product.price_cents,
        quantity: line.quantity,
      });
    } catch (err) {
      return catalogFailure(res, err);
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const orderResult = await client.query(
      'INSERT INTO customer_order (customer_id, status) VALUES ($1, $2) RETURNING id, status, created_at',
      [customer_id, 'PLACED']
    );
    const orderId = orderResult.rows[0].id;
    let totalCents = 0;
    for (const odl of orderLinesData) {
      await client.query(
        `INSERT INTO order_line (order_id, product_id, product_name, unit_price_cents, quantity)
         VALUES ($1, $2, $3, $4, $5)`,
        [orderId, odl.product_id, odl.product_name, odl.unit_price_cents, odl.quantity]
      );
      totalCents += odl.unit_price_cents * odl.quantity;
    }
    await client.query('COMMIT');
    log.info({ order_id: String(orderId), lines: orderLinesData.length }, 'ordine creato');
    res.status(201).json({
      id: orderId,
      customer_id,
      status: 'PLACED',
      total_cents: totalCents,
      lines: orderLinesData,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    log.error({ error: err.message }, 'creazione ordine non riuscita');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.post('/orders/:id/confirm', async (req, res) => {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const carrier = {};
    propagation.inject(context.active(), carrier);
    const r = await startSaga(db, req.params.id, carrier.traceparent);
    await db.query('COMMIT');
    if (r.http === 404) return res.status(404).json({ error: 'ordine non trovato' });
    res.status(r.http).json({ id: Number(req.params.id), status: r.status });
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    log.error({ error: err.message }, 'conferma non riuscita');
    res.status(500).json({ error: 'conferma non riuscita' });
  } finally {
    db.release();
  }
});

app.get('/orders/:id', async (req, res) => {
  try {
    const order = await loadOrder(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    res.json(order);
  } catch (err) {
    log.error({ error: err.message }, 'lettura ordine non riuscita');
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
    catalog_url: process.env.CATALOG_URL,
    kafka: process.env.KAFKA_BOOTSTRAP,
    saga_timeout_s: process.env.SAGA_TIMEOUT_S,
    relay_enabled: process.env.RELAY_ENABLED,
  }, 'configurazione caricata');

  startRelay(pool);
  if (process.env.KAFKA_BOOTSTRAP) {
    consume({
      topic: 'payment.events',
      groupId: 'order-service-saga',
      dlqTopic: 'orders.dlq',
      pool,
      handler: onPaymentEvent,
    }).catch((err) => {
      log.error({ error: err.message }, 'consumer della saga: avvio fallito');
      process.exit(1);
    });
  }

  setInterval(async () => {
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      const n = await expireSagas(db);
      await db.query('COMMIT');
      if (n > 0) log.warn({ annullati: n }, 'saghe scadute annullate');
    } catch (err) {
      await db.query('ROLLBACK').catch(() => {});
      log.error({ error: err.message }, 'controllo delle scadenze fallito');
    } finally {
      db.release();
    }
  }, 5000).unref();

  app.listen(PORT, '0.0.0.0', () => {
    log.info({ port: PORT }, 'order-service in ascolto');
  });
}

main();
