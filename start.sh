#!/bin/bash
# Roda migrations e inicia o servidor
echo "▶ Rodando migrations..."
node src/migrate.js
echo "▶ Iniciando servidor..."
node src/server.js
