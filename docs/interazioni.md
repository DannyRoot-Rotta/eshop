# Interazioni

| Da | A | Modo | Scelta | Perché |
| --- | --- | --- | --- | --- |
| Cliente | order-service | REST sulla Route | sincrono | il cliente aspetta di sapere se l'ordine è stato accettato |
| order-service | catalog-service | REST interno, `CATALOG_URL` | sincrono | nome e prezzo servono nella stessa richiesta, per copiarli nella riga |
| order-service | payment-service | `payment.commands` / `payment.events` | asincrono, saga | non esiste una transazione comune ai due database |
| order-service | notification-service | `orders.events` | asincrono | l'email non deve bloccare né l'ordine né il pagamento |
| catalogo | futuri interessati | evento `Prezzo aggiornato` | non implementato | il prezzo dell'ordine è già una copia: l'evento non serve per chiudere l'acquisto |

La chiamata sincrona è protetta da timeout, retry con jitter, circuit breaker e bulkhead. I messaggi passano dall'outbox, scritta nella stessa transazione del cambio di stato, e il consumatore è idempotente sull'id dell'evento.
