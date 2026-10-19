const client = require('prom-client');

client.collectDefaultMetrics();

const httpDuration = new client.Histogram({
  name: 'http_server_duration_seconds',
  help: 'Durata delle richieste HTTP ricevute',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
});

function httpMetrics(req, res, next) {
  const end = httpDuration.startTimer();
  res.on('finish', () => end({
    method: req.method,
    route: req.route ? req.baseUrl + req.route.path : 'non_trovata',
    status: res.statusCode,
  }));
  next();
}

async function metricsEndpoint(req, res) {
  res.set('Content-Type', client.register.contentType);
  res.end(await client.register.metrics());
}

module.exports = { client, httpMetrics, metricsEndpoint };
