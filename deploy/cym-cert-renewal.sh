#!/usr/bin/env bash
set -Eeuo pipefail
case "${RENEWED_LINEAGE:-}" in
  /etc/letsencrypt/live/cym.green|/etc/letsencrypt/live/admin.cym.green)
    nginx -t
    systemctl reload nginx
    ;;
esac
