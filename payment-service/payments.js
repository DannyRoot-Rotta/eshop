const crypto = require('node:crypto');
const { decide } = require('./decide');

const cloudEvent = (type, orderId, data) => ({
  specversion: '1.0',
  id: crypto.randomUUID(),
  source: '/eshop/payment-service',
  type,
  time: new Date().toISOString(),
  subject: `orders/${orderId}`,
  datacontenttype: 'application/json',
  data,
});

const reply = (db, ev, traceparent) => db.query(
  'INSERT INTO outbox (id, topic, msg_key, payload, traceparent) VALUES ($1, $2, $3, $4::jsonb, $5)',
  [ev.id, 'payment.events', String(ev.data.orderId), JSON.stringify(ev), traceparent ?? null]
);

async function onCommand(db, cmd, traceparent) {
  const { orderId } = cmd.data;
  switch (cmd.type) {
    case 'it.eshop.payment.autorizza.v1': {
      const { ok, reason } = decide(cmd.data.amountCents);
      const r = await db.query(
        `INSERT INTO payment (order_id, amount_cents, status, reason)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (order_id) DO NOTHING`,
        [String(orderId), cmd.data.amountCents, ok ? 'AUTHORIZED' : 'REJECTED', reason]
      );
      if (r.rowCount === 0) return 'duplicato';
      await reply(
        db,
        cloudEvent(
          ok ? 'it.eshop.payment.autorizzato.v1' : 'it.eshop.payment.rifiutato.v1',
          orderId,
          { orderId: String(orderId), amountCents: cmd.data.amountCents, reason }
        ),
        traceparent
      );
      return ok ? 'AUTHORIZED' : 'REJECTED';
    }
    case 'it.eshop.payment.storna.v1': {
      const r = await db.query(
        `UPDATE payment SET status = 'VOIDED', reason = $2, updated_at = now()
           WHERE order_id = $1 AND status = 'AUTHORIZED'`,
        [String(orderId), cmd.data.reason]
      );
      if (r.rowCount === 0) return 'niente da stornare';
      await reply(
        db,
        cloudEvent('it.eshop.payment.stornato.v1', orderId, { orderId: String(orderId) }),
        traceparent
      );
      return 'VOIDED';
    }
    default:
      throw new SyntaxError(`comando non riconosciuto: ${cmd.type}`);
  }
}

module.exports = { onCommand };
