const express = require('express');
const { Pool } = require('pg');
const { Kafka } = require('@confluentinc/kafka-javascript').KafkaJS;
const { context, propagation, trace } = require('@opentelemetry/api');
const log = require('./logger');
const { client, httpMetrics, metricsEndpoint } = require('./metrics');

const notificationsTotal = new client.Counter({
  name: 'notifications_total',
  help: 'Notifiche per esito',
  labelNames: ['outcome'],
});

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
const num = (name, def) => Number(process.env[name] ?? def);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const KNOWN = new Set(['it.eshop.order.confermato.v1', 'it.eshop.order.annullato.v1']);

async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS processed_event (
      event_id     UUID PRIMARY KEY,
      processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS notification (
      id          SERIAL PRIMARY KEY,
      event_id    UUID NOT NULL,
      order_id    INTEGER NOT NULL,
      customer_id TEXT NOT NULL,
      body        TEXT NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
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

app.get('/notifications', async (req, res) => {
  try {
    const { orderId } = req.query;
    const result = await pool.query(
      'SELECT * FROM notification WHERE order_id = $1 ORDER BY id',
      [orderId]
    );
    res.json(result.rows);
  } catch (err) {
    log.error({ error: err.message }, 'lettura notifiche non riuscita');
    res.status(500).json({ error: err.message });
  }
});

app.get('/metrics', metricsEndpoint);

async function handle({ topic, partition, message }) {
  const next = [{ topic, partition, offset: (BigInt(message.offset) + 1n).toString() }];
  const headers = Object.fromEntries(
    Object.entries(message.headers || {}).map(([k, v]) => [k, v?.toString()])
  );
  const parent = propagation.extract(context.active(), headers);
  const tracer = trace.getTracer('notification-service');

  return tracer.startActiveSpan('orders.events process', {}, parent, async (span) => {
    try {
      let event;
      try {
        event = JSON.parse(message.value.toString());
        if (!KNOWN.has(event.type) || !event.id || !event.data?.orderId) {
          throw new Error('evento non riconosciuto');
        }
      } catch (err) {
        log.info({ error: err.message }, 'messaggio non valido, verso la DLQ');
        await dlq.send({
          topic: 'notification.dlq',
          messages: [{
            key: message.key,
            value: message.value,
            headers: {
              'x-errore': err.message,
              'x-origine': `${topic}/${partition}/${message.offset}`,
            },
          }],
        });
        notificationsTotal.inc({ outcome: 'dlq' });
        return consumer.commitOffsets(next);
      }

      for (let tentativo = 1; ; tentativo++) {
        const db = await pool.connect();
        try {
          await db.query('BEGIN');
          const first = await db.query(
            'INSERT INTO processed_event (event_id) VALUES ($1) ON CONFLICT DO NOTHING',
            [event.id]
          );
          if (first.rowCount === 0) {
            await db.query('ROLLBACK');
            log.info({ event_id: event.id }, `duplicato scartato: ${event.id}`);
            notificationsTotal.inc({ outcome: 'duplicate' });
            return consumer.commitOffsets(next);
          }
          const d = event.data;
          const body = event.type === 'it.eshop.order.annullato.v1'
            ? `Il tuo ordine ${d.orderId} è stato annullato: ${d.reason}.`
            : `Il tuo ordine ${d.orderId} è confermato. Totale: ${(d.totalCents / 100).toFixed(2)} euro.`;
          await db.query(
            'INSERT INTO notification (event_id, order_id, customer_id, body) VALUES ($1, $2, $3, $4)',
            [event.id, d.orderId, d.customerId, body]
          );
          await db.query('COMMIT');
          log.info({ customer_id: d.customerId, order_id: d.orderId }, `EMAIL -> cliente ${d.customerId}: ${body}`);
          notificationsTotal.inc({ outcome: 'sent' });
          return consumer.commitOffsets(next);
        } catch (err) {
          await db.query('ROLLBACK').catch(() => {});
          if (tentativo >= num('MAX_ATTEMPTS', 3)) {
            log.error({ error: err.message }, 'errore persistente, riavvio il servizio');
            process.exit(1);
          }
          const wait = Math.random() * Math.min(num('RETRY_CAP_MS', 5000), num('RETRY_BASE_MS', 200) * 2 ** tentativo);
          log.warn({ attempt: tentativo, wait_ms: Math.round(wait), error: err.message }, 'errore transitorio, ritento');
          await sleep(wait);
        } finally {
          db.release();
        }
      }
    } finally {
      span.end();
    }
  });
}

let consumer;
let dlq;

async function startConsumer() {
  const kafka = new Kafka({
    kafkaJS: {
      clientId: 'notification-service',
      brokers: [process.env.KAFKA_BOOTSTRAP],
    },
  });
  consumer = kafka.consumer({
    kafkaJS: {
      groupId: process.env.KAFKA_GROUP || 'notification-service',
      fromBeginning: true,
      autoCommit: false,
    },
  });
  dlq = kafka.producer({ kafkaJS: { acks: -1 } });
  await dlq.connect();
  await consumer.connect();
  await consumer.subscribe({ topics: ['orders.events'] });
  consumerReady = true;
  log.info('consumer: in ascolto su orders.events');
  await consumer.run({ eachMessage: handle });
}

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
    email_key_present: Boolean(process.env.EMAIL_API_KEY),
  }, 'configurazione caricata');
  startConsumer().catch((err) => {
    log.error({ error: err.message }, 'consumer: avvio fallito');
    process.exit(1);
  });
  app.listen(PORT, '0.0.0.0', () => {
    log.info({ port: PORT }, 'notification-service in ascolto');
  });
}

main();
