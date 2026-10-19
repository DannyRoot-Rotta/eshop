#!/bin/bash
# Crea i topic prima che i client partano. La creazione automatica è disattivata.
set -euo pipefail
KT='oc rsh deploy/kafka /opt/kafka/bin'
$KT/kafka-topics.sh --bootstrap-server localhost:9092 --create --if-not-exists \
  --topic orders.events --partitions 3 --replication-factor 1
$KT/kafka-topics.sh --bootstrap-server localhost:9092 --create --if-not-exists \
  --topic notification.dlq --partitions 1 --replication-factor 1
$KT/kafka-topics.sh --bootstrap-server localhost:9092 --create --if-not-exists \
  --topic orders.dlq --partitions 1 --replication-factor 1
$KT/kafka-topics.sh --bootstrap-server localhost:9092 --create --if-not-exists \
  --topic payment.commands --partitions 3 --replication-factor 1
$KT/kafka-topics.sh --bootstrap-server localhost:9092 --create --if-not-exists \
  --topic payment.events --partitions 3 --replication-factor 1
$KT/kafka-topics.sh --bootstrap-server localhost:9092 --create --if-not-exists \
  --topic payment.dlq --partitions 1 --replication-factor 1
$KT/kafka-topics.sh --bootstrap-server localhost:9092 --describe --topic orders.events
$KT/kafka-topics.sh --bootstrap-server localhost:9092 --describe --topic payment.commands
