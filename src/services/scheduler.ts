import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, statSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { execSync } from 'node:child_process'
import { CronExpressionParser } from 'cron-parser'
import { ALLOWED_CHAT_ID, TELEGRAM_BOT_TOKEN } from '../config.js'
import { logger } from '../logger.js'
import { TMUX, isAgentRunning, agentSessionName, agentTmuxSocket, sendToAgentSession } from '../utils/shell.js'
import { listAgentNames } from './agent-manager.js'

const SCHEDULED_TASKS_DIR = join(homedir(), '.claude', 'scheduled-tasks')
const TASK_QUEUE_DIR = join(homedir(), '.claude', 'task-queue')

export { SCHEDULED_TASKS_DIR }

// Ensure queue directory exists
mkdirSync(TASK_QUEUE_DIR, { recursive: true })

export function computeNextRun(cronExpression: string): number {
  const expr = CronExpressionParser.parse(cronExpression)
  return Math.floor(expr.next().getTime() / 1000)
}

export interface ScheduledTask {
  name: string
  description: string
  prompt: string
  schedule: string
  agent: string
  enabled: boolean
  createdAt: number
  type?: 'task' | 'heartbeat'
  lastRun?: number
  lastResult?: string
  nextRun?: number
}

interface QueueItem {
  taskName: string
  prompt: string  // Full prompt with prefix
  agentName: string
  session: string
  type: 'task' | 'heartbeat'
  queuedAt: number
  retries: number
  maxAge: number  // Max milliseconds to keep trying before giving up
  alertSentAt?: number  // Upstream #36 parity: 1h stuck alert timestamp (once per item)
}

// Upstream #36 parity: ha egy queue item >1h-óta vár, egyszer küldünk
// Telegram warning-ot. Nem spam — csak egyszer item-enként.
const QUEUE_STUCK_ALERT_MS = 60 * 60 * 1000

function readFileOr(path: string, fallback: string): string {
  try { return readFileSync(path, 'utf-8') } catch { return fallback }
}

export function parseSkillMdFrontmatter(content: string): { name?: string; description?: string; body: string } {
  const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/)
  if (!fmMatch) return { body: content }
  const yaml = fmMatch[1]
  const body = fmMatch[2].trim()
  const nameMatch = yaml.match(/^name:\s*(.+)$/m)
  const descMatch = yaml.match(/^description:\s*(.+)$/m)
  return {
    name: nameMatch?.[1]?.trim(),
    description: descMatch?.[1]?.trim(),
    body,
  }
}

export function readScheduledTask(taskName: string): ScheduledTask | null {
  const dir = join(SCHEDULED_TASKS_DIR, taskName)
  const skillPath = join(dir, 'SKILL.md')
  const configPath = join(dir, 'task-config.json')
  if (!existsSync(skillPath)) return null

  const skillContent = readFileOr(skillPath, '')
  const { name, description, body } = parseSkillMdFrontmatter(skillContent)

  let config: { schedule?: string; agent?: string; enabled?: boolean; createdAt?: number; type?: string; lastRun?: number; lastResult?: string } = {}
  try {
    config = JSON.parse(readFileOr(configPath, '{}'))
  } catch { /* use defaults */ }

  const schedule = config.schedule || '0 9 * * *'
  let nextRun: number | undefined
  try { nextRun = computeNextRun(schedule) } catch {}

  return {
    name: name || taskName,
    description: description || '',
    prompt: body,
    schedule,
    agent: config.agent || 'nova',
    enabled: config.enabled !== false,
    createdAt: config.createdAt || 0,
    type: (config.type as 'task' | 'heartbeat') || 'task',
    lastRun: config.lastRun,
    lastResult: config.lastResult,
    nextRun,
  }
}

export function listScheduledTasks(): ScheduledTask[] {
  if (!existsSync(SCHEDULED_TASKS_DIR)) return []
  const dirs = readdirSync(SCHEDULED_TASKS_DIR).filter(f => {
    try { return statSync(join(SCHEDULED_TASKS_DIR, f)).isDirectory() } catch { return false }
  })
  const tasks: ScheduledTask[] = []
  for (const d of dirs) {
    const task = readScheduledTask(d)
    if (task) tasks.push(task)
  }
  return tasks.sort((a, b) => b.createdAt - a.createdAt)
}

export function sanitizeScheduleName(raw: string): string {
  return raw.trim().toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

export function writeScheduledTask(
  taskName: string,
  data: { description?: string; prompt?: string; schedule?: string; agent?: string; enabled?: boolean; type?: string }
): void {
  const dir = join(SCHEDULED_TASKS_DIR, taskName)
  mkdirSync(dir, { recursive: true })

  const skillPath = join(dir, 'SKILL.md')
  const configPath = join(dir, 'task-config.json')

  const existing = readScheduledTask(taskName)

  const desc = data.description ?? existing?.description ?? ''
  const prompt = data.prompt ?? existing?.prompt ?? ''
  const skillContent = `---\nname: ${taskName}\ndescription: ${desc}\n---\n\n${prompt}\n`
  writeFileSync(skillPath, skillContent)

  let config: Record<string, unknown> = {}
  try { config = JSON.parse(readFileOr(configPath, '{}')) } catch { /* use empty */ }
  if (data.schedule !== undefined) config.schedule = data.schedule
  if (data.agent !== undefined) config.agent = data.agent
  if (data.enabled !== undefined) config.enabled = data.enabled
  if (data.type !== undefined) config.type = data.type
  if (!config.createdAt) config.createdAt = Math.floor(Date.now() / 1000)
  writeFileSync(configPath, JSON.stringify(config, null, 2))
}

// --- File-based Task Queue ---

function enqueueTask(item: QueueItem): void {
  const filename = `${item.queuedAt}-${item.taskName}.json`
  const filepath = join(TASK_QUEUE_DIR, filename)
  writeFileSync(filepath, JSON.stringify(item, null, 2))
  logger.info({ task: item.taskName, file: filename }, 'Task queued to file')
}

export type { QueueItem }
export function listQueuedTasks(): { filepath: string; item: QueueItem }[] {
  if (!existsSync(TASK_QUEUE_DIR)) return []
  const files = readdirSync(TASK_QUEUE_DIR)
    .filter(f => f.endsWith('.json'))
    .sort() // Oldest first (timestamp prefix)
  const items: { filepath: string; item: QueueItem }[] = []
  for (const f of files) {
    try {
      const filepath = join(TASK_QUEUE_DIR, f)
      const item = JSON.parse(readFileSync(filepath, 'utf-8')) as QueueItem
      items.push({ filepath, item })
    } catch { /* skip corrupt files */ }
  }
  return items
}

function removeFromQueue(filepath: string): void {
  try { unlinkSync(filepath) } catch { /* already gone */ }
}

// --- Session Idle Detection ---

function isSessionIdle(session: string, agentName?: string): boolean {
  const socket = agentName ? agentTmuxSocket(agentName) : null
  const base = socket ? `${TMUX.split(' ')[0]} -S ${socket}` : TMUX
  try {
    const paneContent = execSync(
      `${base} capture-pane -t ${session} -p -S -3`,
      { timeout: 3000, encoding: 'utf-8' }
    ).trim()
    const lastLine = paneContent.split('\n').pop()?.trim() || ''
    const busyPatterns = [/^⠋|^⠙|^⠹|^⠸|^⠼|^⠴|^⠦|^⠧|^⠇|^⠏/, /running/i, /\.\.\.$/, /thinking/i]
    if (busyPatterns.some(p => p.test(lastLine))) return false
    const idlePatterns = [/^\$/, /^>/, /^❯/, /^\s*$/, /^claude/i, /waiting/i]
    if (idlePatterns.some(p => p.test(lastLine))) return true
    return true
  } catch {
    return true
  }
}

// --- Telegram Fallback ---

async function sendTelegramFallback(text: string): Promise<void> {
  if (!TELEGRAM_BOT_TOKEN || !ALLOWED_CHAT_ID) return
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: ALLOWED_CHAT_ID, text }),
    })
    if (!res.ok) {
      logger.warn({ status: res.status }, 'Telegram fallback returned non-OK')
    }
  } catch (err) {
    logger.warn({ err }, 'Telegram fallback notification failed')
  }
}

// --- Fire Task via tmux ---
// Uses temp file + tmux load-buffer to avoid shell escaping issues with backticks, $(), etc.

function fireTaskToSession(prompt: string, session: string, agentName?: string): boolean {
  const tmpFile = join(tmpdir(), `claw-queue-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`)
  const bufName = `claw-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const socket = agentName ? agentTmuxSocket(agentName) : null
  const base = socket ? `${TMUX.split(' ')[0]} -S ${socket}` : TMUX
  try {
    // Flatten to single line and write to temp file
    const singleLine = prompt.replace(/\n/g, ' ')
    writeFileSync(tmpFile, singleLine)

    // Dismiss any pending TUI dialog (feedback prompt, modal) + clear current input line
    try { execSync(`${base} send-keys -t ${session} Escape`, { timeout: 5000 }) } catch { /* ok */ }
    try { execSync(`${base} send-keys -t ${session} C-u`, { timeout: 5000 }) } catch { /* ok */ }

    // Load into a NAMED buffer (avoids race with concurrent tasks sharing the global paste buffer)
    execSync(`${base} load-buffer -b ${bufName} ${tmpFile}`, { timeout: 10000 })
    execSync(`${base} paste-buffer -b ${bufName} -t ${session}`, { timeout: 10000 })
    try { execSync(`${base} delete-buffer -b ${bufName}`, { timeout: 5000 }) } catch { /* ok */ }
    // Submit with C-m (reliable TUI submit). No shell-fork sleep — the paste+send pair
    // naturally has enough delay, and a shell spawn was failing under load (ETIMEDOUT).
    execSync(`${base} send-keys -t ${session} C-m`, { timeout: 10000 })

    return true
  } catch (err) {
    logger.warn({ err, session, agentName }, 'tmux send-keys failed')
    return false
  } finally {
    try { unlinkSync(tmpFile) } catch { /* ok */ }
  }
}

// --- Persist task result ---

function persistTaskResult(taskName: string, now: number, result: string) {
  try {
    const cfgPath = join(SCHEDULED_TASKS_DIR, taskName, 'task-config.json')
    let cfg: Record<string, unknown> = {}
    try { cfg = JSON.parse(readFileOr(cfgPath, '{}')) } catch {}
    cfg.lastRun = Math.floor(now / 1000)
    cfg.lastResult = result
    writeFileSync(cfgPath, JSON.stringify(cfg, null, 2))
  } catch {}
}

// --- Cron Match ---

function cronMatchesNow(cron: string, catchUpMs: number = 60000): boolean {
  try {
    const expr = CronExpressionParser.parse(cron)
    const prev = expr.prev()
    const prevTime = prev.getTime()
    const now = Date.now()
    return (now - prevTime) < catchUpMs
  } catch {
    return false
  }
}

// --- Schedule Runner ---

const scheduleLastRun: Map<string, number> = new Map()

/**
 * Restore the in-memory lastRun cache from persisted task-config.json files.
 * Without this, after a restart the scheduler thinks every task has never run,
 * which can cause double-fires inside the catch-up window.
 */
function hydrateLastRunCache(): void {
  let restored = 0
  for (const task of listScheduledTasks()) {
    if (typeof task.lastRun === "number" && task.lastRun > 0) {
      // task.lastRun is in seconds (persistTaskResult stores epoch sec); cache is in ms.
      scheduleLastRun.set(task.name, task.lastRun * 1000)
      restored++
    }
  }
  logger.info({ restored, total: scheduleLastRun.size }, "Scheduler lastRun cache hydrated")
}
const MAX_QUEUE_AGE = 90 * 60_000 // 90 minutes max in queue
const QUEUE_CHECK_INTERVAL = 15_000 // Check queue every 15 seconds

export function startScheduleRunner(): NodeJS.Timeout {
  hydrateLastRunCache()
  let firstRun = true

  // Step 1: Cron check — puts tasks into the file queue
  function runCronCheck() {
    const tasks = listScheduledTasks()
    const now = Date.now()
    const catchUp = firstRun ? 30 * 60000 : 60000
    firstRun = false

    for (const task of tasks) {
      if (!task.enabled) continue
      if (!cronMatchesNow(task.schedule, catchUp)) continue

      const lastRun = scheduleLastRun.get(task.name) || 0
      if (now - lastRun < catchUp) continue

      let targetAgents: string[]
      if (task.agent === 'all') {
        const running = listAgentNames().filter(a => isAgentRunning(a))
        targetAgents = ['nova', ...running]
      } else {
        targetAgents = [task.agent || 'nova']
      }

      for (const agentName of targetAgents) {
        const isNova = agentName === 'nova'
        const session = isNova ? 'nova-channels' : agentSessionName(agentName)

        let prefix: string
        if (task.type === 'heartbeat') {
          prefix = `[Heartbeat: ${task.name}] FONTOS: Ez egy csendes ellenorzes. CSAK AKKOR irj Telegramon (chat_id: ${ALLOWED_CHAT_ID}), ha tenyleg fontos/surgos dolgot talalsz. Ha minden rendben, NE irj semmit -- maradj csendben. EZ A CSEND-SZABALY CSAK ERRE A HEARTBEAT-FELADATRA VONATKOZIK. Ha kozben Owner vagy mas user uzenetet kuld, valaszolj rendesen reply tool-lal — az NEM heartbeat. `
        } else {
          prefix = `[Utemezett feladat: ${task.name}] Az eredmenyt kuldd el Telegramon (chat_id: ${ALLOWED_CHAT_ID}, reply tool). `
        }

        enqueueTask({
          taskName: task.name,
          prompt: prefix + task.prompt,
          agentName,
          session,
          type: task.type || 'task',
          queuedAt: now,
          retries: 0,
          maxAge: MAX_QUEUE_AGE,
        })

        scheduleLastRun.set(task.name, now)
        persistTaskResult(task.name, now, 'queued')
        logger.info({ task: task.name, agent: agentName }, 'Task added to queue')
      }
    }
  }

  // Step 2: Queue processor — delivers queued tasks when session is idle
  function processQueue() {
    const queued = listQueuedTasks()
    if (queued.length === 0) return

    const now = Date.now()

    for (const { filepath, item } of queued) {
      const age = now - item.queuedAt

      // Check if task expired
      if (age > item.maxAge) {
        logger.warn({ task: item.taskName, ageMin: Math.round(age / 60000) }, 'Queue item expired, sending fallback')
        sendTelegramFallback(
          `⚠️ Ütemezett feladat: "${item.taskName}" — ${Math.round(age / 60000)} percig várt a queue-ban, de a session végig foglalt volt. A feladat nem futott le. Ellenőrizd a rendszert!`
        ).catch(() => {})
        persistTaskResult(item.taskName, now, `expired after ${Math.round(age / 60000)}min in queue`)
        removeFromQueue(filepath)
        continue
      }

      // Check session exists — use agent-specific socket, not just Nova's
      const sessionExists = isAgentRunning(item.agentName)

      if (!sessionExists) {
        // Grace period: session might be restarting — wait up to 2 minutes before giving up
        const SESSION_GRACE_MS = 2 * 60_000
        if (age < SESSION_GRACE_MS) {
          item.retries++
          try { writeFileSync(filepath, JSON.stringify(item, null, 2)) } catch {}
          if (item.retries % 4 === 0) {
            logger.info({ task: item.taskName, session: item.session, retries: item.retries, ageSec: Math.round(age / 1000) }, 'Queue: session not found, waiting for restart')
          }
          break
        }
        logger.warn({ task: item.taskName, session: item.session }, 'Queue: session gone after grace period')
        sendTelegramFallback(
          `❌ Ütemezett feladat: "${item.taskName}" — a session (${item.session}) nem fut (2 perc várakozás után sem). A feladat nem futott le.`
        ).catch(() => {})
        persistTaskResult(item.taskName, now, `dropped (session ${item.session} not found after ${Math.round(age / 1000)}s)`)
        removeFromQueue(filepath)
        continue
      }

      // Check if idle
      if (!isSessionIdle(item.session, item.agentName)) {
        item.retries++

        // Upstream #36 parity: ha >1h-óta vár, küldünk egyszer warning-ot.
        // Az alertSentAt mentésével megakadályozzuk a spam-et.
        if (age > QUEUE_STUCK_ALERT_MS && !item.alertSentAt) {
          item.alertSentAt = now
          logger.warn({ task: item.taskName, ageMin: Math.round(age / 60000) }, 'Queue: stuck >1h, sending alert')
          sendTelegramFallback(
            `⏳ Ütemezett feladat: "${item.taskName}" — ${Math.round(age / 60000)} percig várt a queue-ban, a session (${item.session}) végig foglalt. Még próbálkozom a maxAge-ig (${Math.round(item.maxAge / 60000)} perc), de érdemes megnézni.`
          ).catch(() => {})
        }

        // Update retry count in file
        try { writeFileSync(filepath, JSON.stringify(item, null, 2)) } catch {}
        if (item.retries % 10 === 0) {
          logger.info({ task: item.taskName, retries: item.retries, ageMin: Math.round(age / 60000) }, 'Queue: still waiting for idle session')
        }
        // Only process one task at a time — stop here, try again next cycle
        break
      }

      // Session is idle — fire!
      const success = fireTaskToSession(item.prompt, item.session, item.agentName)
      if (success) {
        logger.info({ task: item.taskName, retries: item.retries, ageMin: Math.round(age / 60000) }, 'Queue: task delivered to session')
        persistTaskResult(item.taskName, now, `delivered after ${item.retries} checks (${Math.round(age / 1000)}s in queue)`)
      } else {
        logger.warn({ task: item.taskName }, 'Queue: tmux send failed')
        persistTaskResult(item.taskName, now, `failed: tmux send-keys error`)
        sendTelegramFallback(
          `❌ Ütemezett feladat: "${item.taskName}" — tmux send-keys hiba. Ellenőrizd a rendszert!`
        ).catch(() => {})
      }
      removeFromQueue(filepath)

      // Only deliver one task per cycle — let it process before sending the next
      break
    }
  }

  // Cron check every 60s
  setTimeout(runCronCheck, 5000)
  const cronInterval = setInterval(runCronCheck, 60000)

  // Queue processor every 15s — fast enough to catch idle windows
  const queueInterval = setInterval(processQueue, QUEUE_CHECK_INTERVAL)

  // Return cron interval (for cleanup)
  // Store queue interval on the timer object so it can be cleaned up too
  ;(cronInterval as any)._queueInterval = queueInterval
  return cronInterval
}
