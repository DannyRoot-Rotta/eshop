# Verifiche Milestone 2

Le prove 6.1–6.8 si eseguono sul namespace con i comandi della guida. Qui le conseguenze attese e le risposte alla 6.9.

- 6.1 La seconda conferma, anche in parallelo, lascia una sola riga in outbox: `FOR UPDATE` serializza le due transazioni e la seconda trova lo stato già diverso da `PLACED`.
- 6.2 Con notification-service spento le conferme rispondono comunque. Il LAG sale e, al ritorno del consumatore, torna a 0: le email partono dopo.
- 6.3 Rimettendo `published_at` a null, il relay ripubblica lo stesso id. Il log dice `duplicato scartato` e `GET /notifications` resta a una riga.
- 6.4 Un reset degli offset all'inizio del topic produce solo duplicati, nessuna email nuova.
- 6.5 Con Kafka spento la conferma risponde lo stesso. La riga resta in outbox e parte quando il broker torna.
- 6.6 Il riavvio di Kafka non perde il messaggio: volume persistente e `CLUSTER_ID` fisso. Senza volume i topic spariscono.
- 6.7 `RELAY_ENABLED=false` lascia la riga non pubblicata. Rimesso a true, l'evento esce e l'email arriva.
- 6.8 Un payload che non è JSON finisce in `notification.dlq` con `x-errore` e `x-origine`. L'ordine successivo viene elaborato.

## 6.9

1. L'email è un log dopo il commit. Se il Pod cade tra commit e log, al riavvio l'evento è già nel registro e viene scartato: l'email non parte. Per l'invio la garanzia è at-most-once. Per renderla at-least-once senza doppioni serve un outbox interno: la riga «da inviare» nasce nel commit della notifica, un relay la spedisce e la marca, e un riavvio riprova solo le righe non marcate.
2. Rileggere il topic ripubblica il messaggio malformato nella dead letter. La DLQ è un topic: non ricorda di aver già visto quel messaggio, quindi i duplicati si accumulano. Va trattata con la stessa idempotenza, oppure svuotata una volta sola.
3. Sono in ordine solo gli eventi con la stessa chiave, cioè lo stesso ordine. Tra ordini diversi non c'è ordine. Una chiave sbagliata è un UUID nuovo a ogni messaggio: `autorizza` e `storna` dello stesso ordine finirebbero su partizioni diverse e potrebbero essere letti al contrario.
4. L'indirizzo non sta nell'evento. Prima strada: notification-service chiede un customer-service, che è l'unico a possedere l'email; si aggiunge un accoppiamento sincrono. Seconda strada: copiare l'email nell'evento; è più semplice ma diffonde un dato personale e una copia che invecchia. Si tiene l'id cliente.
