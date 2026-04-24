import { join } from 'node:path'
import { statSync, existsSync } from 'node:fs'
import { PROJECT_ROOT, STORE_DIR } from '../config.js'
import { getMemoryStats } from '../db.js'
import { json } from '../utils/http.js'
import { readFileOr, listAgentNames } from '../services/agent-manager.js'
import { isAgentRunning } from '../utils/shell.js'
import type { RouteContext } from './types.js'

export async function healthRoutes(ctx: RouteContext, checkAuth: (req: import("node:http").IncomingMessage) => boolean): Promise<boolean> {
  const { path, method, req, res } = ctx

  if (path === '/api/auth/status' && method === 'GET') {
    const ok = checkAuth(req)
    json(res, { authenticated: ok })
    return true
  }

  if (path === '/api/health' && method === 'GET') {
    const mem = process.memoryUsage()
    const health: Record<string, unknown> = {
      status: 'ok',
      uptime: process.uptime(),
      nodeVersion: process.version,
      memoryMB: {
        heap: Math.round(mem.heapUsed / 1024 / 1024),
        rss: Math.round(mem.rss / 1024 / 1024),
        external: Math.round(mem.external / 1024 / 1024),
      },
      timestamp: Date.now(),
    }

    // Event loop lag sample (non-blocking)
    const lagStart = Date.now()
    await new Promise((r) => setImmediate(r))
    health.eventLoopLagMs = Date.now() - lagStart

    // DB health + file size
    try {
      const dbStats = getMemoryStats()
      const dbPath = join(STORE_DIR, 'claudeclaw.db')
      const walPath = dbPath + '-wal'
      health.db = {
        ok: true,
        memories: dbStats.total,
        sizeMB: existsSync(dbPath) ? Math.round(statSync(dbPath).size / 1024 / 1024 * 10) / 10 : null,
        walMB: existsSync(walPath) ? Math.round(statSync(walPath).size / 1024 / 1024 * 10) / 10 : null,
      }
    } catch {
      health.db = { ok: false }
    }

    // Telegram configured?
    try {
      const envPath = join(PROJECT_ROOT, '.env')
      const envContent = readFileOr(envPath, '')
      const tokenMatch = envContent.match(/TELEGRAM_BOT_TOKEN=(.+)/)
      health.telegram = { configured: !!tokenMatch?.[1]?.trim() }
    } catch {
      health.telegram = { configured: false }
    }

    // Agent session state
    try {
      const agents: Record<string, boolean> = { nova: isAgentRunning('nova') }
      for (const name of listAgentNames()) agents[name] = isAgentRunning(name)
      health.agents = agents
    } catch {
      health.agents = {}
    }

    // Overall status: degraded if any agent down or event loop lag > 100ms
    const degraded =
      (health.eventLoopLagMs as number) > 100 ||
      !Object.values((health.agents as Record<string, boolean>) || {}).every(Boolean) ||
      !(health.db as { ok: boolean }).ok
    health.status = degraded ? 'degraded' : 'ok'

    json(res, health)
    return true
  }

  return false
}
