#!/bin/sh
set -eu

install --directory --owner kanleaf --group kanleaf "$KANLEAF_DATA_DIR"
install --directory --owner kanleaf --group kanleaf "$KANLEAF_DATA_DIR/vaults"

exec gosu kanleaf:kanleaf kanleaf-server
