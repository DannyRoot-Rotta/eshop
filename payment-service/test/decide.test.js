const { test } = require('node:test');
const assert = require('node:assert');

process.env.PAYMENT_LIMIT_CENTS = '50000';
const { decide } = require('../decide');

test('entro il limite: autorizzato', () => {
  assert.deepStrictEqual(decide(4900), { ok: true, reason: null });
});

test('al limite esatto: autorizzato', () => {
  assert.strictEqual(decide(50000).ok, true);
});

test('oltre il limite: rifiutato con il motivo', () => {
  assert.match(decide(60000).reason, /500 euro/);
});

test('importo non valido: rifiutato', () => {
  assert.strictEqual(decide(-1).ok, false);
});
