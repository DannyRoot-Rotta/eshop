# Comandi e eventi del pagamento

Tutti in busta CloudEvents. La chiave è l'id dell'ordine: i messaggi di una saga stanno nella stessa partizione.

| Topic | type | Da | A | Dati |
| --- | --- | --- | --- | --- |
| payment.commands | it.eshop.payment.autorizza.v1 | order | payment | orderId, customerId, amountCents |
| payment.commands | it.eshop.payment.storna.v1 | order | payment | orderId, reason |
| payment.events | it.eshop.payment.autorizzato.v1 | payment | order | orderId, amountCents |
| payment.events | it.eshop.payment.rifiutato.v1 | payment | order | orderId, amountCents, reason |
| payment.events | it.eshop.payment.stornato.v1 | payment | order | orderId |

`payment.commands` si comporta come una coda perché lo legge un solo gruppo, `payment-service`. `payment.dlq` e `orders.dlq` raccolgono le buste illeggibili o di tipo sconosciuto. La creazione automatica dei topic è disattivata: li crea `k8s/kafka-topics.sh`.
