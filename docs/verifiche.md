# Verifiche Milestone 1

Osservato sul cluster il 29 ottobre 2026.

- 6.1 Da 1 indirizzo a 3: `10.129.14.15`, `10.131.21.139`, `10.131.21.158`. Poi le repliche sono tornate a 1.
- 6.2 Con catalog-db spento, dopo 25 secondi un indirizzo era ancora presente. Aspettando 45 secondi gli endpoint sono diventati vuoti; riacceso il database è tornato un indirizzo.
- 6.3 Il rollout di catalog-service non ha ricreato il pod di order-service, rimasto quello avviato alle 10:55:33 UTC.
- 6.4 Le variabili del database di order-service puntano solo a `order-db` (`DB_HOST`, nome, utente, porta). Nessuna cita `catalog-db`.
- 6.5 Con l'HPA tolto e catalog-service a zero repliche, `POST /orders` ha risposto 503 in 0,66 secondi con «catalogo momentaneamente non disponibile». `GET /orders/1` ha risposto 200. L'HPA è stato ricreato e il catalogo riportato a una replica. Con l'HPA attivo lo scale a zero viene rifiutato, perché il minimo è 1.

## 6.6 Domanda di controllo

Sì: catalog-service si rilascia da solo. order-service dipende dal contratto `GET /products/{id}` e da `CATALOG_URL`, non dall'immagine del catalogo. Va avvisato chi mantiene gli ordini solo se il contratto cambia in modo incompatibile.
