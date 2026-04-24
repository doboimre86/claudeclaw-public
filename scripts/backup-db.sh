#!/bin/bash
BACKUP_DIR="/srv/claudeclaw/store/backups"
DB="/srv/claudeclaw/store/claudeclaw.db"
mkdir -p "$BACKUP_DIR"
sqlite3 "$DB" ".backup $BACKUP_DIR/claudeclaw-$(date +%Y%m%d-%H%M).db"
# Régi backupok törlése (7 napnál régebbi)
find "$BACKUP_DIR" -name "claudeclaw-*.db" -mtime +7 -delete
echo "Backup done: $(date)"
