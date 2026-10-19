#!/bin/bash
# Crea i quattro PostgreSQL dal template del cluster.
# Le password vanno passate nell'ambiente e non vanno committate.
set -euo pipefail
: "${CATALOG_DB_PASSWORD:?}"
: "${ORDER_DB_PASSWORD:?}"
: "${NOTIFICATION_DB_PASSWORD:?}"
: "${PAYMENT_DB_PASSWORD:?}"

oc new-app postgresql-persistent \
  -p DATABASE_SERVICE_NAME=catalog-db \
  -p POSTGRESQL_DATABASE=catalog \
  -p POSTGRESQL_USER=catalog \
  -p POSTGRESQL_PASSWORD="$CATALOG_DB_PASSWORD" \
  -p VOLUME_CAPACITY=1Gi \
  -p MEMORY_LIMIT=512Mi \
  -l app.kubernetes.io/part-of=eshop

oc new-app postgresql-persistent \
  -p DATABASE_SERVICE_NAME=order-db \
  -p POSTGRESQL_DATABASE=orders \
  -p POSTGRESQL_USER=orders \
  -p POSTGRESQL_PASSWORD="$ORDER_DB_PASSWORD" \
  -p VOLUME_CAPACITY=1Gi \
  -p MEMORY_LIMIT=512Mi \
  -l app.kubernetes.io/part-of=eshop

oc new-app postgresql-persistent \
  -p DATABASE_SERVICE_NAME=notification-db \
  -p POSTGRESQL_DATABASE=notifications \
  -p POSTGRESQL_USER=notifications \
  -p POSTGRESQL_PASSWORD="$NOTIFICATION_DB_PASSWORD" \
  -p VOLUME_CAPACITY=1Gi \
  -p MEMORY_LIMIT=512Mi \
  -l app.kubernetes.io/part-of=eshop

oc new-app postgresql-persistent \
  -p DATABASE_SERVICE_NAME=payment-db \
  -p POSTGRESQL_DATABASE=payments \
  -p POSTGRESQL_USER=payments \
  -p POSTGRESQL_PASSWORD="$PAYMENT_DB_PASSWORD" \
  -p VOLUME_CAPACITY=1Gi \
  -p MEMORY_LIMIT=512Mi \
  -l app.kubernetes.io/part-of=eshop
