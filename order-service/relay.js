const { Kafka } = require('@confluentinc/kafka-javascript').KafkaJS;
const log = require('./logger');
const { client } = require('./metrics');

const pending = new client.Gauge({
  name: 'outbox_pending',
  help: 'Righe di outbox non ancora pubblicate',
});

function startRelay(pool) {
  const kafka = new Kafka({
    kafkaJS: {
      clientId: process.env.OTEL_SERVICE_NAME || 'order-service',
      brokers: [process.env.KAFKA_BOOTSTRAP],
    },
  });
  const producer = kafka.producer({ kafkaJS: { idempotent: true, acks: -1 } });
  let connected = false;
  let running = false;

  async function connectProducer() {
    try {
      await producer.connect();
      connected = true;
      log.info('relay: connesso a Kafka');
    } catch (err) {
      connected = false;
      log.info({ error: err.message }, 'relay: Kafka non raggiungibile, riprovo tra 5 s');
      setTimeout(connectProducer, 5000);
    }
  }

  async function relayOnce() {
    try {
      const count = await pool.query("SELECT count(*)::int AS n FROM outbox WHERE published_at IS NULL");
      pending.set(count.rows[0].n);
    } catch (err) {
      log.warn({ error: err.message }, 'relay: conteggio outbox non riuscito');
    }
    if (running || !connected || process.env.RELAY_ENABLED === 'false') return;
    running = true;
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      const { rows } = await db.query(
        `SELECT id, topic, msg_key, payload, traceparent FROM outbox
           WHERE published_at IS NULL ORDER BY created_at LIMIT 20
           FOR UPDATE SKIP LOCKED`
      );
      if (rows.length > 0) {
        await Promise.all(rows.map((r) => producer.send({
          topic: r.topic,
          messages: [{
            key: r.msg_key,
            value: JSON.stringify(r.payload),
            headers: {
              'content-type': 'application/cloudevents+json',
              ...(r.traceparent && { traceparent: r.traceparent }),
            },
          }],
        })));
        await db.query(
          'UPDATE outbox SET published_at = now() WHERE id = ANY($1::uuid[])',
          [rows.map((r) => r.id)]
        );
        log.info({ count: rows.length }, `relay: pubblicati ${rows.length} eventi`);
      }
      await db.query('COMMIT');
    } catch (err) {
      await db.query('ROLLBACK').catch(() => {});
      log.info({ error: err.message }, 'relay: pubblicazione non riuscita, riprovo al prossimo giro');
    } finally {
      db.release();
      running = false;
    }
  }

  if (process.env.KAFKA_BOOTSTRAP) connectProducer();
  setInterval(relayOnce, 1000).unref();
}

module.exports = { startRelay };
