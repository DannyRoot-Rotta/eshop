# Verifiche Milestone 3

Permessi da annotare all'avvio, sul namespace:

```bash
oc auth can-i create servicemonitors.monitoring.coreos.com
oc auth can-i create networkpolicies
oc auth can-i create horizontalpodautoscalers
oc get networkpolicy
```

Il ServiceMonitor è in `k8s/servicemonitor.yaml` e si applica solo se il primo comando risponde yes. Le NetworkPolicy stanno in `k8s/networkpolicy.yaml`: se una policy del namespace ammette già tutto il traffico interno, le regole non stringono e resta valido il disegno in `docs/resilienza-m3.md`.

## Esiti attesi

- 6.1 Venti ordini in parallelo contro un catalogo rallentato di 5 secondi rispondono 503 in circa 2,5 secondi, con due righe `ritento la chiamata` e poi `circuito aperto`. La richiesta successiva risponde 503 in pochi millisecondi, con `Retry-After: 15`.
- 6.2 A ritardo tolto, senza riavviare order-service, compaiono `circuito semiaperto` e `circuito chiuso`. La metrica `circuit_breaker_state` torna a 0 e l'ordine risponde 201.
- 6.3 Venti ordini con un prodotto inesistente rispondono 422, zero righe `ritento`, circuito a 0.
- 6.4 La creazione porta lo stesso `trace_id` in order-service e catalog-service. La conferma ne porta un altro, lo stesso, in order-service e notification-service, passando da outbox e Kafka.
- 6.5 Le metriche usano route `/orders` e `/orders/:id/confirm`, mai l'id numerico.
- 6.6 Con order-db a zero il Pod di order-service diventa non pronto e il contatore dei restart non sale. Al ritorno del database torna pronto da solo.
- 6.7 Sotto carico l'HPA di catalog-service sale fino a 3 e, spento il carico, riscende a 1 dopo la finestra di 120 secondi.
- 6.8 Cambiare la password nel Secret e riavviare database e servizio non crea una build nuova.
- 6.9 `CB_RESET_MS` nel Pod cambia solo dopo `oc rollout restart`.

## 6.10

1. Due repliche di order-service hanno due circuiti indipendenti. Nella prova 6.1 una parte delle richieste può ancora raggiungere il catalogo attraverso il Pod il cui circuito è chiuso. È accettabile: ogni istanza protegge se stessa, e un circuito aperto non spegne tutto il servizio.
2. Allo scadere dei 2,5 secondi il cliente riceve 503, ma i tentativi già partiti arrivano in fondo al loro timeout. Il costo resta su catalog-service.
3. A dieci repliche di catalog il collo di bottiglia diventa catalog-db, un solo PostgreSQL, e subito dopo la quota del namespace.
4. SLI proposto: quota di `POST /orders` che termina in meno di un secondo, contando i 201 e i 4xx come esiti noti e i 5xx come errori. Si calcola da `http_server_duration_seconds` con route `/orders`. La conferma è un secondo SLI: tempo fra il 202 e lo stato finale, oggi visibile nei log con lo stesso trace id.
