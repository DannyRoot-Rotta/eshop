# OrdineConfermato

| Campo | Valore |
| --- | --- |
| type | `it.eshop.order.confermato.v1` |
| topic | `orders.events` |
| chiave | id dell'ordine, stringa |
| producer | order-service, dopo un pagamento autorizzato e solo se l'ordine è ancora `PAYMENT_PENDING` |
| consumer oggi | notification-service, gruppo `notification-service` |

L'id dell'evento è un UUID generato una volta, quando la riga entra nell'outbox, e non cambia se il relay pubblica due volte.

```json
{
  "specversion": "1.0",
  "id": "3f9c2b1e-6d0a-4c7e-9a51-2b8f7c1d4e60",
  "source": "/eshop/order-service",
  "type": "it.eshop.order.confermato.v1",
  "time": "2026-10-01T09:14:03Z",
  "subject": "orders/1042",
  "datacontenttype": "application/json",
  "data": {
    "orderId": "1042",
    "customerId": "C-001",
    "totalCents": 4900,
    "lines": [{ "productName": "Tazza", "quantity": 2, "unitPriceCents": 1200 }]
  }
}
```

Non ci sono dati personali oltre l'id cliente. Il prezzo è quello copiato nell'ordine, non il listino attuale.

# OrdineAnnullato

| Campo | Valore |
| --- | --- |
| type | `it.eshop.order.annullato.v1` |
| topic | `orders.events` |
| chiave | id dell'ordine |
| producer | order-service, su rifiuto del pagamento o su scadenza della saga |
| consumer | notification-service |

`data` contiene `orderId`, `customerId` e `reason`. Un tipo sconosciuto sullo stesso topic finisce in `notification.dlq` e non blocca la partizione.
