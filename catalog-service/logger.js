const pino = require('pino');
const { trace } = require('@opentelemetry/api');

module.exports = pino({
  level: process.env.LOG_LEVEL || 'info',
  base: { service: process.env.OTEL_SERVICE_NAME },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: { level: (label) => ({ level: label }) },
  mixin() {
    const span = trace.getActiveSpan();
    if (!span) return {};
    const ctx = span.spanContext();
    return {
      trace_id: ctx.traceId,
      span_id: ctx.spanId,
      trace_flags: ctx.traceFlags,
    };
  },
});
