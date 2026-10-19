const CircuitBreaker = require('opossum');
const log = require('./logger');
const { client } = require('./metrics');

const num = (name, def) => Number(process.env[name] ?? def);
const cfg = {
  url: process.env.CATALOG_URL,
  timeoutMs: num('CATALOG_TIMEOUT_MS', 800),
  retries: num('CATALOG_RETRIES', 2),
  baseMs: num('RETRY_BASE_MS', 100),
  capMs: num('RETRY_CAP_MS', 1000),
  resetMs: num('CB_RESET_MS', 15000),
};

class HttpError extends Error {
  constructor(status, id) {
    super(status === 404 ? `prodotto ${id} inesistente` : `catalog-service ha risposto ${status}`);
    this.status = status;
  }
}

const isTransient = (err) => !(err instanceof HttpError) || [502, 503, 504].includes(err.status);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getOnce(id) {
  const res = await fetch(`${cfg.url}/products/${encodeURIComponent(id)}`, {
    signal: AbortSignal.timeout(cfg.timeoutMs),
  });
  if (!res.ok) throw new HttpError(res.status, id);
  return res.json();
}

async function getWithRetry(id) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await getOnce(id);
    } catch (err) {
      if (attempt > cfg.retries || !isTransient(err)) throw err;
      const wait = Math.random() * Math.min(cfg.capMs, cfg.baseMs * 2 ** attempt);
      log.warn({
        dependency: 'catalog-service',
        attempt,
        wait_ms: Math.round(wait),
        error: err.message,
      }, 'ritento la chiamata');
      await sleep(wait);
    }
  }
}

const breaker = new CircuitBreaker(getWithRetry, {
  timeout: num('CB_TIMEOUT_MS', 2500),
  errorThresholdPercentage: num('CB_ERROR_PERCENT', 50),
  volumeThreshold: num('CB_VOLUME', 10),
  rollingCountTimeout: num('CB_WINDOW_MS', 10000),
  resetTimeout: cfg.resetMs,
  capacity: num('CB_CAPACITY', 50),
  errorFilter: (err) => err instanceof HttpError && err.status < 500,
});

const state = new client.Gauge({
  name: 'circuit_breaker_state',
  help: '0 chiuso, 1 semiaperto, 2 aperto',
  labelNames: ['dependency'],
});
const calls = new client.Counter({
  name: 'dependency_calls_total',
  help: 'Esiti delle chiamate alle dipendenze',
  labelNames: ['dependency', 'outcome'],
});
const dep = { dependency: 'catalog-service' };
state.set(dep, 0);
breaker.on('open', () => { state.set(dep, 2); log.error({ ...dep, circuit: 'open' }, 'circuito aperto'); });
breaker.on('halfOpen', () => { state.set(dep, 1); log.warn({ ...dep, circuit: 'half-open' }, 'circuito semiaperto: chiamata di prova'); });
breaker.on('close', () => { state.set(dep, 0); log.info({ ...dep, circuit: 'closed' }, 'circuito chiuso'); });
for (const outcome of ['success', 'failure', 'timeout', 'reject', 'semaphoreLocked']) {
  breaker.on(outcome, () => calls.inc({ ...dep, outcome }));
}

module.exports = {
  getProduct: (id) => breaker.fire(id),
  circuitState: () => (breaker.opened ? 'open' : breaker.halfOpen ? 'half-open' : 'closed'),
  retryAfterSeconds: Math.ceil(cfg.resetMs / 1000),
  HttpError,
};
