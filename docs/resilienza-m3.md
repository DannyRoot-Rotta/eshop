# Resilienza

## Dipendenze di order → catalog

| Protezione | Valore | Effetto |
| --- | --- | --- |
| Bulkhead | 50 chiamate contemporanee | oltre il limite si rifiuta subito |
| Circuit breaker | 50% di errori su almeno 10 chiamate in 10 s, reset 15 s | a circuito aperto non si parte |
| Retry | 2 tentativi in più, full jitter, solo su rete e 502/503/504 | un 404 non si ritenta |
| Timeout | 800 ms a tentativo, budget del circuito 2,5 s | il cliente non resta appeso |

Il retry sta dentro il circuito: un circuito aperto smette di ritentare. `errorFilter` esclude i 4xx, così ordini con un prodotto inesistente non spengono il catalogo per tutti. Il fallback è 503 con `Retry-After`: nessun prezzo inventato.

Il ritardo iniettabile è `CATALOG_DELAY_MS` in catalog-config. Le probe non passano da `/products`, quindi un catalogo lento resta nel bilanciamento.

La liveness di ogni servizio guarda solo il processo. La readiness guarda il database (e, per notification e payment, il consumer avviato). Il catalogo non entra nella readiness degli ordini: se è giù, order-service resta raggiungibile e risponde 503 in fretta.

## Mappa di rete

| Chi riceve | Da chi | Porta |
| --- | --- | --- |
| order-service | router della Route | 8080 |
| catalog-service | order-service | 8080 |
| kafka | order, notification, payment | 9092 |
| catalog-db | catalog-service | 5432 |
| order-db | order-service | 5432 |
| notification-db | notification-service | 5432 |
| payment-db | payment-service | 5432 |
| tutti i servizi | monitoraggio, per `/metrics` | 8080 |
| tutto il resto | nessuno | — |

Le regole sono in `k8s/networkpolicy.yaml`. Vanno applicate solo se nel namespace non c'è già una policy che lascia passare tutto il traffico interno: in quel caso le regole restrittive non hanno effetto e resta valido il disegno.
