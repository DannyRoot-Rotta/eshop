# Verifiche Milestone 4

Permessi osservati: create su pipelineruns.tekton.dev, cronjobs e rolebindings è consentito.

## Osservato il 29 ottobre 2026

- 7.1 La conferma ha risposto 202. L'ordine è poi risultato `CONFIRMED`, il pagamento `AUTHORIZED` e nel log di notification-service c'era l'email.
- 7.2 Un ordine da 60000 centesimi (50 tazze) ha avuto il pagamento `REJECTED` con motivo «importo oltre il limite di 500 euro». L'ordine è passato a `CANCELLED` con `pagamento rifiutato: importo oltre il limite di 500 euro`.
- 7.3 Con payment-service spento, dopo 40 secondi l'ordine 40 era `CANCELLED` per «nessuna risposta dal pagamento entro il tempo massimo». Al ritorno del servizio il pagamento è `VOIDED` con motivo «autorizzazione arrivata dopo l'annullamento».
- 7.4 Una seconda conferma dell'ordine 1 ha risposto 200. Il reset di `payment.commands` è stato rifiutato perché il gruppo `payment-service` era ancora Stable, quindi i `duplicato` da rilettura non sono stati contati.
- 7.5 In `payment.dlq` c'è `non sono json` con `x-errore` e `x-origine: payment.commands/2/5`.
- 7.6 La Pipeline `payment-ci` è nel cluster, ma nessuna PipelineRun è stata eseguita. L'overlay punta ancora a `payment-service:latest`. Il 9 novembre la console non riconosce più l'utente, quindi build, tag dello sha e rollback non sono stati rifatti.
- 7.7 Con payment-service a zero repliche e `PAYMENT_LIMIT_CENTS=100`, un job con il service account `riconciliatore` ha applicato `k8s/overlays/sandbox`. Subito dopo le repliche erano 1 e il limite 50000.

Il riconciliatore è stato sospeso durante le prove che spengono payment-service, poi riattivato.

## Esiti attesi dalla guida

- 7.1 La conferma risponde 202 con `PAYMENT_PENDING`. Pochi secondi dopo l'ordine è `CONFIRMED`, il pagamento `AUTHORIZED`, e nei log c'è l'email di conferma. Lo stesso trace id compare in order, payment e notification.
- 7.2 Un ordine oltre 500 euro finisce `CANCELLED`, il pagamento `REJECTED`, il motivo cita il limite, e l'email è di annullamento.
- 7.3 Con payment-service spento, dopo 30 secondi l'ordine è `CANCELLED` per scadenza. Al ritorno del servizio l'autorizzazione tardiva non riapre l'ordine: il pagamento diventa `VOIDED`.
- 7.4 Una nuova conferma sullo stesso ordine risponde 200 senza un comando nuovo. Rileggere `payment.commands` dall'inizio produce un `duplicato` per ogni autorizzazione già decisa.
- 7.5 Un testo che non è JSON e un type sconosciuto finiscono in `payment.dlq`. Gli altri comandi proseguono.
- 7.6 La pipeline produce `payment-service:<sha7>`. Scrivere quel tag nell'overlay e lasciare girare il riconciliatore cambia l'immagine del Deployment. Un revert del commit la riporta indietro.
- 7.7 Azzerare le repliche a mano e cambiare `PAYMENT_LIMIT_CENTS` viene corretto al giro successivo: una replica e limite `50000`, come su Git.

Durante 7.3 e 7.4 il riconciliatore va sospeso, altrimenti riporta payment-service a una replica. A fine lavoro: `oc patch cronjob/riconciliatore -p '{"spec":{"suspend":true}}'`.

## 7.8

1. La conferma risponde 202 perché l'esito non c'è ancora: dipende da un altro servizio. Il client interroga `GET /orders/{id}` oppure aspetta la notifica.
2. Il pivot è `CONFIRMED`. Dopo quel punto la saga non torna indietro. Un passo successivo che può fallire, come la spedizione, non annulla il pagamento da solo: serve una compensazione nuova, esplicita.
3. Per qualche secondo l'ordine annullato e il pagamento autorizzato convivono. Non è un errore: i due database non hanno un commit comune. Lo storno è la compensazione, non un rollback, perché l'autorizzazione è già un fatto committato.
4. `FOR UPDATE SKIP LOCKED` fa sì che due repliche di order-service prendano ordini diversi senza aspettarsi e senza annullare due volte lo stesso. La condizione sullo stato basterebbe a non transire due volte; il lock evita l'attesa e la doppia lettura.
5. La pipeline costruisce un'immagine identificata dal commit. Quale immagine gira lo decide l'overlay su Git. Un test rotto non pubblica nulla, e il ritorno indietro è un revert, non una build.
6. Argo CD cancellerebbe dal cluster una risorsa tolta da Git, e mostrerebbe sync e salute. Questo riconciliatore no: nella 7.7 corregge ciò che Git descrive, ma un oggetto in più resterebbe. Si vede anche che non reagisce a un webhook: applica ogni cinque minuti.
