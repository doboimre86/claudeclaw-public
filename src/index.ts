import { scheduleDreamCycle, stopDreamCycle } from "./services/dreaming.js"
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { PROJECT_ROOT, STORE_DIR, WEB_PORT, ALLOWED_CHAT_ID } from './config.js'
import { initDatabase } from './db.js'
import { runDecaySweep, runDailyDigest } from './memory.js'
import { initHeartbeat, stopHeartbeat } from './heartbeat.js'
import { startUptimePush, stopUptimePush } from './uptime-push.js'
import { startWebServer } from './server.js'
import { logger } from './logger.js'

const BANNER = `
 ██████╗██╗      █████╗ ██╗   ██╗██████╗ ███████╗
██╔════╝██║     ██╔══██╗██║   ██║██╔══██╗██╔════╝
██║     ██║     ███████║██║   ██║██║  ██║█████╗
██║     ██║     ██╔══██║██║   ██║██║  ██║██╔══╝
╚██████╗███████╗██║  ██║╚██████╔╝██████╔╝███████╗
 ╚═════╝╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚═════╝╚══════╝
 ██████╗██╗      █████╗ ██╗    ██╗
██╔════╝██║     ██╔══██╗██║    ██║
██║     ██║     ███████║██║ █╗ ██║
██║     ██║     ██╔══██║██║███╗██║
╚██████╗███████╗██║  ██║╚███╔███╔╝
 ╚═════╝╚══════╝╚═╝  ╚═╝ ╚══╝╚══╝  (lite)
`

const PID_FILE = join(STORE_DIR, 'claudeclaw.pid')
let dailyDigestInterval: ReturnType<typeof setInterval> | null = null

// Upstream #35 ihletésre: a régi acquireLock csak SIGTERM-et küldött, nem várta
// meg, és nem volt SIGKILL fallback. Ha az előző példánynak live HTTP keep-alive
// kapcsolata volt (pl. böngésző tab), a webServer.close() blokkolt, process.exit
// sosem futott → zombi példány, amelynek scheduler/heartbeat timerei tovább
// futottak. Observed: 3 dashboard futott párhuzamosan és a scheduled prompt a
// rossz tmux pane-be ment.
async function acquireLock(): Promise<void> {
  mkdirSync(STORE_DIR, { recursive: true })

  if (existsSync(PID_FILE)) {
    const oldPid = parseInt(readFileSync(PID_FILE, 'utf-8').trim(), 10)
    if (oldPid && oldPid !== process.pid) {
      try {
        process.kill(oldPid, 0)  // még él?
        logger.warn({ oldPid }, 'Korabbi peldany megallitasa (SIGTERM)...')
        process.kill(oldPid, 'SIGTERM')
        // Grace window: max 5s, 250ms pollinggel. Ha nem hal meg, SIGKILL.
        const deadline = Date.now() + 5000
        let dead = false
        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 250))
          try { process.kill(oldPid, 0) } catch { dead = true; break }
        }
        if (!dead) {
          logger.warn({ oldPid }, 'Korabbi peldany nem all meg, SIGKILL...')
          try { process.kill(oldPid, 'SIGKILL') } catch { /* lehet mar halott */ }
          await new Promise((r) => setTimeout(r, 500))
        }
      } catch {
        // nem fut már, rendben
      }
    }
  }

  writeFileSync(PID_FILE, String(process.pid))
  logger.info({ pid: process.pid }, 'Zarolasi fajl letrehozva')
}

function releaseLock(): void {
  try {
    unlinkSync(PID_FILE)
  } catch {
    // ignorálható
  }
}

let dailyDigestTimer: ReturnType<typeof setTimeout> | null = null

async function main(): Promise<void> {
  console.log(BANNER)

  await acquireLock()

  // Database — code-review #32: ha az init fail-el, releaseLock lefusson
  // mielőtt process.exit, hogy ne ragadjon a PID fájl.
  try {
    initDatabase()
  } catch (err) {
    logger.error({ err }, 'DB init hiba — releaseLock + kilepes')
    releaseLock()
    throw err
  }
  logger.info('Adatbazis inicializalva')

  // Dream cycle (code-review #31: kitesszük a scheduleDailyDigest-bol,
  // hogy ne hívódjon újra ha a digest újraütemezne)
  scheduleDreamCycle()

  // Memory decay (24h cycle)
  runDecaySweep()
  const decayInterval = setInterval(runDecaySweep, 24 * 60 * 60 * 1000)
  logger.info('Memoria leepulesi ciklus beallitva (24 oras)')

  // Daily digest at 23:00
  function scheduleDailyDigest() {
    const now = new Date()
    const target = new Date(now)
    target.setHours(23, 0, 0, 0)
    if (target <= now) target.setDate(target.getDate() + 1)
    const msUntil = target.getTime() - now.getTime()
    // code-review #28: mentjük a setTimeout-ot shutdown-hoz.
    dailyDigestTimer = setTimeout(() => {
      runDailyDigest(ALLOWED_CHAT_ID).catch((err) =>
        logger.error({ err }, 'Napi naplo hiba')
      )
      dailyDigestInterval = setInterval(() => {
        runDailyDigest(ALLOWED_CHAT_ID).catch((err) =>
          logger.error({ err }, 'Napi naplo hiba')
        )
      }, 24 * 60 * 60 * 1000)
    }, msUntil)
    logger.info({ nextRun: target.toLocaleString('hu-HU') }, 'Napi naplo utemezve')
  }
  scheduleDailyDigest()

  // Heartbeat
  initHeartbeat()
  logger.info('Heartbeat utemezo elindult')

  // Uptime Kuma push monitor
  startUptimePush()

  // Web dashboard
  const webServer = startWebServer(WEB_PORT)

  // Shutdown handlers — upstream #35: graceful close timeout-tal.
  // Ha a webServer.close() nem tér vissza 5s-en belül (live keep-alive
  // connection blokkol), force-exit hogy ne maradjon zombi.
  let shuttingDown = false
  const shutdown = () => {
    if (shuttingDown) return  // re-entry védelem (dupla SIGTERM)
    shuttingDown = true
    logger.info('Leallitas...')
    stopHeartbeat()
    stopUptimePush()
    stopDreamCycle()
    clearInterval(decayInterval)
    if (dailyDigestTimer) clearTimeout(dailyDigestTimer)
    if (dailyDigestInterval) clearInterval(dailyDigestInterval)
    const forceExitTimer = setTimeout(() => {
      logger.warn('webServer.close() 5s-en belul nem tert vissza, force-exit')
      releaseLock()
      process.exit(0)
    }, 5000)
    forceExitTimer.unref()  // ne blokkolja az event loop-ot
    webServer.close(() => {
      clearTimeout(forceExitTimer)
      releaseLock()
      process.exit(0)
    })
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  logger.info(`ClaudeClaw Lite fut! Dashboard: http://localhost:${WEB_PORT}`)
  logger.info('Telegram kommunikacio: Claude Code Channels kezeli')
}

main().catch((err) => {
  logger.error({ err }, 'Vegzetes hiba')
  releaseLock()
  process.exit(1)
})
