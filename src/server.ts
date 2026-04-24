import http from 'node:http'
import { existsSync, readFileSync, mkdirSync, writeFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { PROJECT_ROOT } from './config.js'
import { logger } from './logger.js'
import { json, serveFile } from './utils/http.js'
import { getSessionToken, setSessionCookie, clearSessionCookie } from './utils/cookie.js'
import { ensureAgentDirs } from './services/agent-manager.js'
import { startMessageRouter } from './services/message-router.js'
import { startScheduleRunner } from './services/scheduler.js'
import {
  healthRoutes, webhookRoutes, agentsRoutes, schedulesRoutes,
  kanbanRoutes, messagesRoutes, memoriesRoutes, dailyLogRoutes,
  novaRoutes, connectorsRoutes, ollamaRoutes, migrateRoutes,
  chatRoutes, statusRoutes, updatesRoutes,
    dreamingRoutes,
  type RouteContext,
} from './routes/index.js'

const WEB_DIR = join(PROJECT_ROOT, 'web')

// Preferáld a minified változatot, DE csak ha nem elavult a forráshoz képest.
// Ha a forrás újabb mint a min (vagy a min hiányzik), a forrást szolgáljuk ki.
// Így az "elavult .min" probléma (2026-04-17) nem tud visszatérni.
function pickFreshest(dir: string, source: string, minified: string): string {
  const srcPath = join(dir, source)
  const minPath = join(dir, minified)
  if (!existsSync(minPath)) return srcPath
  if (!existsSync(srcPath)) return minPath
  try {
    const srcMtime = statSync(srcPath).mtimeMs
    const minMtime = statSync(minPath).mtimeMs
    return minMtime >= srcMtime ? minPath : srcPath
  } catch {
    return srcPath
  }
}

// --- Dashboard auth ---
const DASHBOARD_TOKEN_PATH = join(PROJECT_ROOT, 'store', '.dashboard-token')

function loadOrCreateDashboardToken(): string {
  const fromEnv = process.env.DASHBOARD_TOKEN?.trim()
  if (fromEnv) return fromEnv
  try {
    if (existsSync(DASHBOARD_TOKEN_PATH)) {
      const cached = readFileSync(DASHBOARD_TOKEN_PATH, 'utf-8').trim()
      if (cached) return cached
    }
  } catch { /* fall through and regenerate */ }
  const fresh = randomBytes(32).toString('hex')
  mkdirSync(join(PROJECT_ROOT, 'store'), { recursive: true })
  writeFileSync(DASHBOARD_TOKEN_PATH, fresh, { mode: 0o600 })
  return fresh
}

// --- Rate limiting (IP-based, in-memory sliding window) ---
type BucketState = { count: number; resetAt: number }
const rateLimitBuckets = new Map<string, BucketState>()

function rateLimit(ip: string, key: string, maxPerMinute: number): boolean {
  const now = Date.now()
  const bucketKey = `${key}:${ip}`
  const b = rateLimitBuckets.get(bucketKey)
  if (!b || now >= b.resetAt) {
    rateLimitBuckets.set(bucketKey, { count: 1, resetAt: now + 60_000 })
    return true
  }
  if (b.count >= maxPerMinute) return false
  b.count++
  return true
}

// Periodic cleanup of expired buckets (every 5 min)
setInterval(() => {
  const now = Date.now()
  for (const [k, b] of rateLimitBuckets) if (b.resetAt <= now) rateLimitBuckets.delete(k)
}, 5 * 60_000).unref()

function getClientIp(req: http.IncomingMessage): string {
  const xff = req.headers['x-forwarded-for']
  if (typeof xff === 'string') return xff.split(',')[0].trim()
  return req.socket.remoteAddress || 'unknown'
}

function checkBearerToken(header: string | undefined, expected: string): boolean {
  if (!header) return false
  const m = /^Bearer\s+(.+)$/.exec(header)
  if (!m) return false
  const provided = Buffer.from(m[1].trim())
  const wanted = Buffer.from(expected)
  if (provided.length !== wanted.length) return false
  return timingSafeEqual(provided, wanted)
}

function checkRawToken(token: string | null | undefined, expected: string): boolean {
  if (!token) return false
  const provided = Buffer.from(token)
  const wanted = Buffer.from(expected)
  if (provided.length !== wanted.length) return false
  return timingSafeEqual(provided, wanted)
}

/** Accept either Authorization: Bearer <token> OR cc_session HttpOnly cookie. */
function checkSessionAuth(req: http.IncomingMessage, expected: string): boolean {
  if (checkBearerToken(req.headers.authorization, expected)) return true
  return checkRawToken(getSessionToken(req), expected)
}

// === HTTP Server ===

export function startWebServer(port = 3420): http.Server {
  ensureAgentDirs()

  const DASHBOARD_TOKEN = loadOrCreateDashboardToken()
  const allowedOrigins = new Set([
    `http://localhost:${port}`,
    `http://127.0.0.1:${port}`,
    'https://dashboard.example.com',
  ])
  const isSafeMethod = (m: string) => m === 'GET' || m === 'HEAD' || m === 'OPTIONS'

  const routeHandlers = [
    agentsRoutes, schedulesRoutes, kanbanRoutes, messagesRoutes,
    memoriesRoutes, dailyLogRoutes, novaRoutes, connectorsRoutes,
    ollamaRoutes, migrateRoutes, chatRoutes, statusRoutes, dreamingRoutes,
    updatesRoutes,
  ]

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://localhost:${port}`)
    const path = url.pathname
    const method = req.method || 'GET'

    // CSRF / CORS
    const origin = req.headers.origin
    if (origin && allowedOrigins.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin)
      res.setHeader('Vary', 'Origin')
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    }
    res.setHeader('X-Frame-Options', 'DENY')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()')
    res.setHeader('Content-Security-Policy', [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join('; '))
    if (method === 'OPTIONS') { res.writeHead(204); res.end(); return }

    // Rate limiting
    if (path.startsWith('/api/')) {
      const ip = getClientIp(req)
      let limit = 300
      if (path === '/api/webhook') limit = 10
      else if (path === '/api/chat/stream' || path === '/api/chat') limit = 20
      else if (path.includes('/skills') && method === 'POST') limit = 30
      // Security #11: updates endpoints git fetch + build / restart hívnak.
      // Bárki auth-olt user nem ütheti GitHub-ot DoS-sig, sem ne triggereljen
      // rebuild-et gyakran. 5/perc elég.
      else if (path.startsWith('/api/updates/')) limit = 5
      if (!rateLimit(ip, path, limit)) {
        res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '60' })
        res.end(JSON.stringify({ error: 'Rate limit exceeded' }))
        return
      }
    }

    if (!isSafeMethod(method) && origin && !allowedOrigins.has(origin)) {
      res.writeHead(403, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Origin not allowed' }))
      return
    }

    // Public API endpoints (no auth)
    const isPublicApi =
      (path === '/api/auth/status' && method === 'GET') ||
      (path === '/api/auth/login' && method === 'POST') ||
      (path === '/api/auth/logout' && method === 'POST') ||
      (path === '/api/health' && method === 'GET') ||
      (path === '/api/webhook' && method === 'POST') ||
      (method === 'GET' && (
        path === '/api/nova/avatar' ||
        /^\/api\/agents\/[^/]+\/avatar$/.test(path)
      ))

    const ctx: RouteContext = { url, path, method, req, res }

    // Health & auth status (public, but needs checkAuth)
    const healthHandled = await healthRoutes(ctx, (r) => checkSessionAuth(r, DASHBOARD_TOKEN))
    if (healthHandled) return

    // Webhook (public)
    const webhookHandled = await webhookRoutes(ctx)
    if (webhookHandled) return

    // === Cookie-based auth (login / logout) — public, must precede the auth gate ===
    if (path === '/api/auth/login' && method === 'POST') {
      let body = ''
      try { for await (const chunk of req) body += chunk } catch {}
      let token = ''
      try { token = (JSON.parse(body || '{}') as { token?: string }).token?.trim() ?? '' } catch {}
      if (!checkRawToken(token, DASHBOARD_TOKEN)) { json(res, { error: 'Invalid token' }, 401); return }
      setSessionCookie(req, res, token)
      json(res, { authenticated: true })
      return
    }
    if (path === '/api/auth/logout' && method === 'POST') {
      clearSessionCookie(req, res)
      json(res, { authenticated: false })
      return
    }

    // Auth gate for remaining API routes
    if (path.startsWith('/api/') && !isPublicApi) {
      if (!checkSessionAuth(req, DASHBOARD_TOKEN)) {
        res.writeHead(401, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Unauthorized' }))
        return
      }
    }

    try {
      // Try all route handlers
      for (const handler of routeHandlers) {
        const handled = await handler(ctx)
        if (handled) return
      }

      // === Static files ===
      if (path === '/' || path === '/index.html') return serveFile(res, join(WEB_DIR, 'index.html'), req)
      if (path === '/style.css') return serveFile(res, pickFreshest(WEB_DIR, 'style.css', 'style.min.css'), req)
      if (path === '/app.js') return serveFile(res, pickFreshest(WEB_DIR, 'app.js', 'app.min.js'), req)
      if (path.startsWith('/avatars/')) {
        const avatarFile = path.replace('/avatars/', '')
        const avatarPath = join(WEB_DIR, 'avatars', avatarFile)
        if (existsSync(avatarPath)) return serveFile(res, avatarPath)
        res.writeHead(404); res.end(); return
      }

      // 404
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ error: 'Not found' }))
    } catch (err) {
      logger.error({ err }, 'Web szerver hiba')
      json(res, { error: 'Szerver hiba' }, 500)
    }
  })

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      logger.error({ port }, `Port ${port} already in use. Stop the other process first.`)
      process.exit(1)
    } else {
      logger.error({ err }, 'Web szerver hiba')
    }
  })

  server.listen(port, '0.0.0.0', () => {
    logger.info({ port }, `Web dashboard: http://localhost:${port}`)
    // Security #4: token fragment-ben (#token=...) nem megy a szerverhez,
    // ezért sem a Traefik access-log, sem a proxy cache, sem a Referer nem
    // látja. A frontend `location.hash`-ből olvassa és POST-olja cookie-ra.
    // A valódi tokent csak `cat /srv/claudeclaw/store/.dashboard-token` adja.
    logger.info(`Dashboard access URL (fragment-based, token: store/.dashboard-token):\n  http://127.0.0.1:${port}/#token=<hidden>`)
  })

  const routerInterval = startMessageRouter()
  logger.info('Agent message router started (5s poll)')

  const scheduleInterval = startScheduleRunner()
  logger.info('Schedule runner started (60s poll)')

  const origClose = server.close.bind(server)
  server.close = (cb?: (err?: Error) => void) => {
    clearInterval(routerInterval)
    clearInterval(scheduleInterval)
    return origClose(cb)
  }

  return server
}
