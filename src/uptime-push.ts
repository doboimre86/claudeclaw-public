import { logger } from "./logger.js"

/**
 * Periodically POST to an Uptime Kuma "push" monitor so it knows the
 * dashboard is alive. The monitor itself is created in Uptime Kuma with
 * type=push and a generated token; we just need to hit the URL.
 *
 * Configure with env vars:
 *   UPTIME_KUMA_PUSH_URL — full URL of the push endpoint, e.g.
 *     https://uptime.example.com/api/push/nova-heartbeat-pjqwx7k2
 *   UPTIME_KUMA_PUSH_INTERVAL_SEC — seconds between pings (default: 60)
 *
 * If UPTIME_KUMA_PUSH_URL is missing, the module is a no-op (silent in prod,
 * info-log on init so you know).
 */

let timer: NodeJS.Timeout | null = null

async function pushOnce(url: string): Promise<void> {
  const start = Date.now()
  const u = new URL(url)
  // Append status=up&msg=OK&ping=<ms> as query params
  u.searchParams.set("status", "up")
  u.searchParams.set("msg", "OK")
  // Best-effort ping value: time spent in this very call (resolved post-fetch)
  try {
    const res = await fetch(u.toString(), { method: "GET", signal: AbortSignal.timeout(8000) })
    const ping = Date.now() - start
    if (!res.ok) {
      logger.warn({ status: res.status, ping }, "Uptime Kuma push: non-2xx response")
    }
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "Uptime Kuma push: fetch failed")
  }
}

export function startUptimePush(): void {
  const url = process.env["UPTIME_KUMA_PUSH_URL"]?.trim()
  if (!url) {
    logger.info("Uptime Kuma push disabled (UPTIME_KUMA_PUSH_URL not set)")
    return
  }
  const intervalSec = Number(process.env["UPTIME_KUMA_PUSH_INTERVAL_SEC"] ?? 60)
  const intervalMs = Math.max(15, intervalSec) * 1000

  // Fire one immediate ping on startup so the monitor turns green right away
  void pushOnce(url)

  timer = setInterval(() => void pushOnce(url), intervalMs)
  timer.unref()
  logger.info({ url, intervalSec }, "Uptime Kuma push elindult")
}

export function stopUptimePush(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}
