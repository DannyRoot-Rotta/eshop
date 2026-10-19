const { NodeSDK } = require('@opentelemetry/sdk-node');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
const { NoopSpanProcessor } = require('@opentelemetry/sdk-trace-base');

new NodeSDK({
  serviceName: process.env.OTEL_SERVICE_NAME,
  spanProcessors: [new NoopSpanProcessor()],
  instrumentations: [
    getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-fs': { enabled: false },
    }),
  ],
}).start();
