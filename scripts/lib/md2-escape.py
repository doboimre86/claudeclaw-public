#!/usr/bin/env python3
"""MarkdownV2 escape for Telegram. Used by telegram-notify.sh."""
import sys
SPECIAL = set(r"_*[]()~`>#+-=|{}.!\\")
out = "".join("\\" + c if c in SPECIAL else c for c in sys.argv[1] if True)
sys.stdout.write(out)
