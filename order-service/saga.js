const crypto = require('node:crypto');
const log = require('./logger');

const SAGA_TIMEOUT_S = Number(process.env.SAGA_TIMEOUT_S || 30);

const cloudEvent = (type, orderId, data) => ({
  specversion: '1.0',
  id: crypto.randomUUID(),
  source: '/eshop/order-service',
  type,
  time: new Date().toISOString(),
  subject: `orders/${orderId}`,
  datacontenttype: 'application/json',
  data,
});

async function toOutbox(db, topic, event, traceparent) {
  await db.query(
    'INSERT INTO outbox (id, topic, msg_key, payload, traceparent) VALUES ($1, $2, $3, $4::jsonb, $5)',
    [event.id, topic, String(event.data.orderId), JSON.stringify(event), traceparent ?? null]
  );
}

async function startSaga(db, orderId, traceparent) {
  const { rows } = await db.query(
    'SELECT id, customer_id, status FROM customer_order WHERE id = $1 FOR UPDATE',
    [orderId]
  );
  if (rows.length === 0) return { http: 404 };
  if (rows[0].status !== 'PLACED') return { http: 200, status: rows[0].status };

  const { rows: [t] } = await db.query(
    'SELECT COALESCE(SUM(quantity * unit_price_cents), 0)::int AS total FROM order_line WHERE order_id = $1',
    [orderId]
  );
  await db.query(
    `UPDATE customer_order
        SET status = 'PAYMENT_PENDING', saga_deadline = now() + make_interval(secs => $2)
      WHERE id = $1`,
    [orderId, SAGA_TIMEOUT_S]
  );
  await toOutbox(db, 'payment.commands', cloudEvent('it.eshop.payment.autorizza.v1', orderId, {
    orderId: String(orderId),
    customerId: rows[0].customer_id,
    amountCents: t.total,
  }), traceparent);
  log.info({ order_id: String(orderId), amount_cents: t.total }, 'saga avviata');
  return { http: 202, status: 'PAYMENT_PENDING' };
}

async function cancel(db, orderId, reason, traceparent) {
  const r = await db.query(
    `UPDATE customer_order SET status = 'CANCELLED', cancel_reason = $2
       WHERE id = $1 AND status = 'PAYMENT_PENDING' RETURNING customer_id`,
    [orderId, reason]
  );
  if (r.rowCount === 0) return false;
  await toOutbox(db, 'orders.events', cloudEvent('it.eshop.order.annullato.v1', orderId, {
    orderId: String(orderId),
    customerId: r.rows[0].customer_id,
    reason,
  }), traceparent);
  log.info({ order_id: String(orderId), reason }, 'ordine annullato');
  return true;
}

async function onPaymentEvent(db, ev, traceparent) {
  const orderId = ev.data.orderId;
  switch (ev.type) {
    case 'it.eshop.payment.autorizzato.v1': {
      const r = await db.query(
        `UPDATE customer_order SET status = 'CONFIRMED'
           WHERE id = $1 AND status = 'PAYMENT_PENDING' RETURNING customer_id`,
        [orderId]
      );
      if (r.rowCount === 1) {
        const { rows: lines } = await db.query(
          'SELECT product_name, quantity, unit_price_cents FROM order_line WHERE order_id = $1',
          [orderId]
        );
        await toOutbox(db, 'orders.events', cloudEvent('it.eshop.order.confermato.v1', orderId, {
          orderId: String(orderId),
          customerId: r.rows[0].customer_id,
          totalCents: lines.reduce((t, l) => t + l.quantity * l.unit_price_cents, 0),
          lines: lines.map((l) => ({
            productName: l.product_name,
            quantity: l.quantity,
            unitPriceCents: l.unit_price_cents,
          })),
        }), traceparent);
        log.info({ order_id: String(orderId) }, 'ordine confermato');
        return 'confermato';
      }
      const { rows } = await db.query('SELECT status FROM customer_order WHERE id = $1', [orderId]);
      if (rows[0]?.status === 'CANCELLED') {
        await toOutbox(db, 'payment.commands', cloudEvent('it.eshop.payment.storna.v1', orderId, {
          orderId: String(orderId),
          reason: "autorizzazione arrivata dopo l'annullamento",
        }), traceparent);
        log.info({ order_id: String(orderId) }, 'storno richiesto');
        return 'storno richiesto';
      }
      return 'duplicato';
    }
    case 'it.eshop.payment.rifiutato.v1':
      return (await cancel(db, orderId, `pagamento rifiutato: ${ev.data.reason}`, traceparent))
        ? 'annullato'
        : 'duplicato';
    case 'it.eshop.payment.stornato.v1':
      log.info({ order_id: String(orderId) }, 'storno confermato');
      return 'storno confermato';
    default:
      throw new SyntaxError(`evento non riconosciuto: ${ev.type}`);
  }
}

async function expireSagas(db) {
  const { rows } = await db.query(
    `SELECT id FROM customer_order
       WHERE status = 'PAYMENT_PENDING' AND saga_deadline < now()
       ORDER BY saga_deadline LIMIT 20 FOR UPDATE SKIP LOCKED`
  );
  for (const r of rows) {
    await cancel(db, r.id, 'nessuna risposta dal pagamento entro il tempo massimo');
  }
  return rows.length;
}

module.exports = { startSaga, onPaymentEvent, expireSagas };
