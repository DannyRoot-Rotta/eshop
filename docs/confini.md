# Confini dell'e-shop

Il sistema è spezzato lungo i fatti che cambiano insieme e che usano parole diverse. Catalogo, ordini, pagamenti e notifiche non condividono tabelle né credenziali.

**Catalogo.** Possiede il prodotto e il prezzo di listino. Si spiega con una frase sola: pubblica ciò che si può comprare. Un altro team può riscriverlo senza toccare gli ordini, perché l'ordine non legge la sua tabella: chiede il prodotto con `GET /products/{id}` e ne copia nome e prezzo. Il prezzo di listino può cambiare dopo; il prezzo dell'ordine no.

**Ordini.** Possiede l'ordine e le sue righe, un solo aggregato scritto in una transazione. Il cliente è solo un identificatore: il contesto cliente non è implementato. La conferma non è più un aggiornamento locale: avvia la saga e resta in attesa del pagamento.

**Pagamenti.** Possiede la decisione su un ordine (autorizzato, rifiutato, stornato). Non conosce le righe e non incassa denaro vero: il limite `PAYMENT_LIMIT_CENTS` simula il rifiuto. Un comando ripetuto non crea un secondo pagamento, perché la chiave è l'id dell'ordine.

**Notifiche.** Possiede il registro degli eventi già visti e il testo inviato. Non decide nulla sull'ordine: se è spento, gli ordini si confermano lo stesso e il messaggio resta nel topic.

Le chiamate sincrone sono una sola, order verso catalog, perché il prezzo serve nel momento in cui l'ordine nasce. Tutto il resto è un messaggio: il topic esiste anche se chi ascolta non c'è. `Prezzo aggiornato` resta un evento futuro, non una chiamata.
