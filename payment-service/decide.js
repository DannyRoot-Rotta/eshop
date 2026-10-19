const LIMIT = Number(process.env.PAYMENT_LIMIT_CENTS || 50000);

function decide(amountCents) {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    return { ok: false, reason: 'importo non valido' };
  }
  if (amountCents > LIMIT) {
    return { ok: false, reason: `importo oltre il limite di ${LIMIT / 100} euro` };
  }
  return { ok: true, reason: null };
}

module.exports = { decide };
