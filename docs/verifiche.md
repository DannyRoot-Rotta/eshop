# Verifiche Milestone 1

## 6.1 Service discovery

`oc scale deploy/catalog-service --replicas=3` fa crescere gli indirizzi in `oc get endpoints catalog-service`. order-service continua a chiamare il nome `catalog-service`: non conosce gli IP.

## 6.2 Pod non pronti

Se `/health/ready` risponde 503, l'indirizzo esce dagli endpoint e ci rientra quando il database torna. Poi le repliche vanno riportate a 1.

## 6.3 Rilascio indipendente

`oc rollout restart deploy/catalog-service` non ricrea i Pod di order-service. Una modifica al catalogo si pubblica con `oc start-build catalog-service` senza ricostruire gli ordini.

## 6.4 Database non condiviso

`oc set env deploy/order-service --list` mostra solo `order-db`. Nessuna variabile punta a `catalog-db`.

## 6.5 Fallimento parziale

Con catalog-service a zero repliche, `POST /orders` risponde 503 entro il budget di 2,5 secondi. `GET /orders/{id}` degli ordini già salvati continua a rispondere 200.

## 6.6 Domanda di controllo

Sì: catalog-service si rilascia da solo. order-service dipende dal contratto `GET /products/{id}` e da `CATALOG_URL`, non dall'immagine del catalogo. Va avvisato chi mantiene gli ordini solo se il contratto cambia in modo incompatibile.
