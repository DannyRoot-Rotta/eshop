const express = require('express');
const { Pool } = require('pg');
const log = require('./logger');
const { httpMetrics, metricsEndpoint } = require('./metrics');

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

const delayMs = Number(process.env.CATALOG_DELAY_MS || 0);
if (delayMs > 0) log.warn({ delay_ms: delayMs }, 'ritardo iniettato attivo');
app.use('/products', (req, res, next) => (delayMs > 0 ? setTimeout(next, delayMs) : next()));

async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS product (
      id          SERIAL PRIMARY KEY,
      name        TEXT NOT NULL,
      price_cents INTEGER NOT NULL CHECK (price_cents > 0),
      published   BOOLEAN NOT NULL DEFAULT false
    )
  `);
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

app.get('/products', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM product WHERE published = true ORDER BY id');
    res.json(result.rows);
  } catch (err) {
    log.error({ error: err.message }, 'elenco prodotti non riuscito');
    res.status(500).json({ error: err.message });
  }
});

app.get('/products/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('SELECT * FROM product WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: `prodotto ${id} inesistente` });
    }
    log.info({ product_id: result.rows[0].id }, 'prodotto letto');
    res.json(result.rows[0]);
  } catch (err) {
    log.error({ error: err.message }, 'lettura prodotto non riuscita');
    res.status(500).json({ error: err.message });
  }
});

app.post('/products', async (req, res) => {
  try {
    const { name, price_cents, published } = req.body;
    if (!name || !Number.isInteger(price_cents) || price_cents <= 0) {
      return res.status(400).json({ error: 'name e price_cents > 0 sono obbligatori' });
    }
    const result = await pool.query(
      'INSERT INTO product (name, price_cents, published) VALUES ($1, $2, $3) RETURNING *',
      [name, price_cents, published || false]
    );
    log.info({ product_id: result.rows[0].id }, 'prodotto creato');
    res.status(201).json(result.rows[0]);
  } catch (err) {
    log.error({ error: err.message }, 'creazione prodotto non riuscita');
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
    port: PORT,
    delay_ms: delayMs,
  }, 'configurazione caricata');
  app.listen(PORT, '0.0.0.0', () => {
    log.info({ port: PORT }, 'catalog-service in ascolto');
  });
}

main();
