# Verifiche Milestone 1

Osservato sul progetto `daniele-vespa-dev` il 13 novembre 2026.

- 6.1 Da un indirizzo a tre: `10.128.5.210`, `10.129.4.40`, `10.131.5.26`. Poi le repliche sono tornate a 1.
- 6.2 Con catalog-db spento, dopo 45 secondi gli endpoint erano vuoti. Riacceso il database è tornato `10.131.5.26`.
- 6.3 Il rollout di catalog-service non ha ricreato il pod di order-service: è rimasto `order-service-5bc8bd9f8c-svcpn`.
- 6.4 Le variabili del database sono solo `DB_DATABASE_NAME`, `DB_PORT`, `DB_HOST`, `DB_DATABASE_USER` e `DB_DATABASE_PASSWORD`. Nessuna cita il catalogo.
- 6.5 Con l'HPA tolto e catalog-service a zero repliche, `POST /orders` ha risposto 503 in 0,96 secondi con «catalogo momentaneamente non disponibile». `GET /orders/1` ha risposto 200. L'HPA è stato ricreato e il catalogo riportato a una replica.

## 6.6 Domanda di controllo

Sì: catalog-service si rilascia da solo. order-service dipende dal contratto `GET /products/{id}` e da `CATALOG_URL`, non dall'immagine del catalogo. Va avvisato chi mantiene gli ordini solo se il contratto cambia in modo incompatibile.
