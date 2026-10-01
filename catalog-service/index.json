const express = require('express');
const { Pool } = require('pg');

const app = express();
app.use(express.json());

// Connessione al DB basata sulle variabili d'ambiente iniettate da OpenShift
const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_DATABASE_NAME,
  user: process.env.DB_DATABASE_USER,
  password: process.env.DB_DATABASE_PASSWORD,
});

// Health check (Readiness probe)
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.status(200).send('OK');
  } catch (err) {
    res.status(503).send('Database unreachable');
  }
});

// Elenco prodotti
app.get('/products', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM product WHERE published = true');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Dettaglio singolo prodotto (usato da order-service)
app.get('/products/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('SELECT * FROM product WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Crea prodotto
app.post('/products', async (req, res) => {
  try {
    const { name, price_cents, published } = req.body;
    const result = await pool.query(
      'INSERT INTO product (name, price_cents, published) VALUES ($1, $2, $3) RETURNING *',
      [name, price_cents, published || false]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Catalog service running on port ${PORT}`);
});