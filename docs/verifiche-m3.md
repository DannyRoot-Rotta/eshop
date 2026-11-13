# Verifiche Milestone 3

Permessi osservati il 13 novembre 2026: create su servicemonitors e horizontal pod autoscalers è consentito. Nel namespace ci sono già policy `allow-from-codeready-workspaces-operator`, `allow-from-console-namespaces`, `allow-from-dev-sandbox-managed-ns`, `allow-from-olm-namespaces`, `allow-from-openshift-ingress`, `allow-from-openshift-monitoring`, `allow-from-openshift-virtualization-namespaces`, `allow-from-redhat-ods-app-to-mariadb`, `allow-from-redhat-ods-app-to-mm` e `allow-same-namespace`. Una NetworkPolicy nostra si sommerebbe a queste, quindi non stringe il traffico: il disegno resta in `docs/resilienza-m3.md` e `k8s/networkpolicy.yaml` non è stato applicato.

## Osservato

- 6.1 Con `CATALOG_DELAY_MS=5000` nel processo nuovo, venti `POST /orders` paralleli hanno risposto tutti 503. Nel log: 40 `ritento la chiamata` e un `circuito aperto`. La richiesta successiva ha risposto 503 in 0,38 secondi.
- 6.2 Tolto il ritardo e riavviato solo il catalogo, dopo 16 secondi un ordine ha risposto 201 in 0,44 secondi e `circuit_breaker_state` era 0.
- 6.3 Venti ordini sul prodotto 999999, letti sul pod appena avviato, hanno risposto tutti 422, con zero `ritento la chiamata`.
- 6.4 La creazione ha usato il trace `c1a88925f42f96d8d012e7cbb12d852a` anche nel catalogo. La conferma ha usato `2f91cfd7d840992e7da71d14e204148f` anche in notification-service.
- 6.5 `http_server_duration_seconds_count` ha le route `/orders` e `/orders/:id/confirm`, non l'id dell'ordine.
- 6.6 Con order-db a zero, dopo 60 secondi il pod era non pronto, `/health/ready` rispondeva 503 e i restart sono rimasti 0. Al ritorno del database il servizio è tornato pronto da solo. La prima immagine usciva ancora, perché il pool trattava la chiusura della connessione come errore non gestito: il commit `5edf776` lo registra e lascia il processo in vita.
- 6.7 Sotto carico le repliche di catalog-service sono passate da 1 a 3. Spento il carico, dopo la finestra di discesa sono tornate a 1.
- 6.8 La password di catalog-db è stata cambiata nel database e nel Secret, database e servizio sono stati riavviati, `/health/ready` ha risposto 200 e le build di catalog-service sono rimaste 2. Il ServiceMonitor `eshop` è stato creato.
- 6.9 `CB_RESET_MS` è rimasto 15000 nel processo subito dopo la modifica della ConfigMap. Dopo il rollout del solo order-service era 30000. Poi è stato riportato a 15000.

## Esiti attesi dalla guida

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
