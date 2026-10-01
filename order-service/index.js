const express = require('express');
const { Pool } = require('pg');

const app = express();
app.use(express.json());

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_DATABASE_NAME,
  user: process.env.DB_DATABASE_USER,
  password: process.env.DB_DATABASE_PASSWORD,
});

const CATALOG_URL = process.env.CATALOG_URL || 'http://catalog-service:8080';

// Health check
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.status(200).send('OK');
  } catch (err) {
    res.status(503).send('Database unreachable');
  }
});

// Crea ordine con timeout e copia dei prezzi
app.post('/orders', async (req, res) => {
  const { customer_id, lines } = req.body;
  if (!lines || lines.length === 0) {
    return res.status(400).json({ error: 'At least one order line is required' });
  }

  const client = await pool.connect();
  try {
    const orderLinesData = [];

    // 1. Chiamate al catalogo con timeout di 2 secondi
    for (const line of lines) {
      if (!line.quantity || line.quantity <= 0) {
        return res.status(400).json({ error: 'Invalid quantity' });
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);

      let catalogRes;
      try {
        catalogRes = await fetch(`${CATALOG_URL}/products/${line.product_id}`, {
          signal: controller.signal,
        });
      } catch (err) {
        clearTimeout(timeoutId);
        return res.status(503).json({ error: 'Catalog service unreachable or timeout' });
      }
      clearTimeout(timeoutId);

      if (catalogRes.status === 404) {
        return res.status(422).json({ error: `Product with id ${line.product_id} not found` });
      }
      if (!catalogRes.ok) {
        return res.status(503).json({ error: 'Error communicating with catalog service' });
      }

      const product = await catalogRes.json();
      orderLinesData.push({
        product_id: product.id,
        product_name: product.name,
        unit_price_cents: product.price_cents,
        quantity: line.quantity,
      });
    }

    // 2. Transazione sul database degli ordini
    await client.query('BEGIN');
    const orderResult = await client.query(
      'INSERT INTO customer_order (customer_id, status) VALUES ($1, $2) RETURNING id, status, created_at',
      [customer_id, 'PLACED']
    );
    const orderId = orderResult.rows[0].id;

    let totalCents = 0;
    for (const odl of orderLinesData) {
      await client.query(
        'INSERT INTO order_line (order_id, product_id, product_name, unit_price_cents, quantity) VALUES ($1, $2, $3, $4, $5)',
        [orderId, odl.product_id, odl.product_name, odl.unit_price_cents, odl.quantity]
      );
      totalCents += odl.unit_price_cents * odl.quantity;
    }

    await client.query('COMMIT');

    res.status(201).json({
      id: orderId,
      customer_id,
      status: 'PLACED',
      total_cents: totalCents,
      lines: orderLinesData,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Dettaglio ordine
app.get('/orders/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const orderRes = await pool.query('SELECT * FROM customer_order WHERE id = $1', [id]);
    if (orderRes.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }
    const linesRes = await pool.query('SELECT * FROM order_line WHERE order_id = $1', [id]);
    
    const order = orderRes.rows[0];
    order.lines = linesRes.rows;
    res.json(order);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Order service running on port ${PORT}`);
});
