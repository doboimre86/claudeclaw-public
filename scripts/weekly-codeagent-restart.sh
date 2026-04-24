#!/bin/bash
# Heti proaktív codeagent restart — memória-felhalmozódás megelőzés.
# Cron: 0 4 * * 0 (vasárnap hajnal 4:00)

LOG=/var/log/claudeclaw-weekly-restart.log
source /srv/claudeclaw/scripts/lib/telegram-notify.sh 2>/dev/null

echo "$(date "+%F %T") heti restart indul (claude-code-channels)" >> "$LOG"

# Kiindulási memória
mem_before=$(cat /sys/fs/cgroup/system.slice/claude-code-channels.service/memory.current 2>/dev/null || echo 0)
mem_before_mb=$(( mem_before / 1024 / 1024 ))

systemctl restart claude-code-channels
sleep 15

state=$(systemctl is-active claude-code-channels)
mem_after=$(cat /sys/fs/cgroup/system.slice/claude-code-channels.service/memory.current 2>/dev/null || echo 0)
mem_after_mb=$(( mem_after / 1024 / 1024 ))

if [ "$state" = "active" ]; then
  echo "$(date "+%F %T") restart OK — memória ${mem_before_mb}M → ${mem_after_mb}M" >> "$LOG"
  tg_notify success "Heti codeagent restart kész" \
    "Vasárnap hajnali proaktív restart sikeresen lefutott. A memória felszabadult, codeagent friss sessionnel megy tovább." \
    "Memória előtte: ${mem_before_mb} MB
Memória utána: ${mem_after_mb} MB
Állapot: $state
Időpont: $(date "+%H:%M")
Következő: jövő vasárnap 04:00"
else
  echo "$(date "+%F %T") restart HIBA — state=$state" >> "$LOG"
  tg_notify error "Heti codeagent restart HIBA" \
    "A vasárnapi restart után a service nem indult vissza. Kézi beavatkozás kell." \
    "Állapot: $state
Időpont: $(date "+%H:%M")
Log: /var/log/claudeclaw-weekly-restart.log"
fi
