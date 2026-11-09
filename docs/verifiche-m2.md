# Verifiche Milestone 2

Osservato sul cluster il 29 ottobre 2026.

- 6.1 La prima conferma dell'ordine 2 ha risposto 202. La seconda ha risposto 200. In outbox ci sono due righe con la stessa chiave: il comando `payment.commands` e, dopo l'autorizzazione, l'evento `orders.events`. La seconda conferma non ne ha aggiunta una terza.
- 6.2 Con notification-service spento il gruppo non aveva membri e il LAG era 1, 3 e 0 sulle tre partizioni. Al ritorno il LAG è tornato a 0 su tutte.
- 6.3 Rimettere `published_at` a null ha prodotto una riga `duplicato scartato` e nessuna email nuova nello stesso intervallo.
- 6.4 Il reset di `orders.events` per il gruppo `notification-service` è stato rifiutato: lo stato del gruppo era ancora Stable. Senza membri inattivi Kafka non sposta gli offset, quindi la rilettura non è stata osservata.
- 6.5 Con Kafka a zero repliche la conferma ha risposto 202 e in outbox c'era una riga senza `published_at`. A broker tornato, le righe non pubblicate erano 0.
- 6.6 Lo stesso spegnimento e riavvio ha consegnato la riga rimasta in outbox. Il volume e il `CLUSTER_ID` non sono stati cancellati.
- 6.7 Con `RELAY_ENABLED=false` nel processo nuovo, la conferma 202 dell'ordine 63 ha lasciato 1 riga non pubblicata. Rimesso `true` e riavviato il servizio, le righe non pubblicate sono tornate a 0.
- 6.8 Il testo `questo non e JSON` è in `notification.dlq` con header `x-errore` e `x-origine: orders.events/2/3`.

## 6.9

1. L'email è un log dopo il commit. Se il Pod cade tra commit e log, al riavvio l'evento è già nel registro e viene scartato: l'email non parte. Per l'invio la garanzia è at-most-once. Per renderla at-least-once senza doppioni serve un outbox interno: la riga «da inviare» nasce nel commit della notifica, un relay la spedisce e la marca, e un riavvio riprova solo le righe non marcate.
2. Rileggere il topic ripubblica il messaggio malformato nella dead letter. La DLQ è un topic: non ricorda di aver già visto quel messaggio, quindi i duplicati si accumulano. Va trattata con la stessa idempotenza, oppure svuotata una volta sola.
3. Sono in ordine solo gli eventi con la stessa chiave, cioè lo stesso ordine. Tra ordini diversi non c'è ordine. Una chiave sbagliata è un UUID nuovo a ogni messaggio: `autorizza` e `storna` dello stesso ordine finirebbero su partizioni diverse e potrebbero essere letti al contrario.
4. L'indirizzo non sta nell'evento. Prima strada: notification-service chiede un customer-service, che è l'unico a possedere l'email; si aggiunge un accoppiamento sincrono. Seconda strada: copiare l'email nell'evento; è più semplice ma diffonde un dato personale e una copia che invecchia. Si tiene l'id cliente.
