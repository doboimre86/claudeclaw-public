import { timingSafeEqual } from 'node:crypto'
import { appendDailyLog, saveAgentMemory } from '../db.js'
import { logger } from '../logger.js'
import { readBody, json } from '../utils/http.js'
import { sendToAgentSession, isAgentRunning } from '../utils/shell.js'
import { wrapUntrusted } from '../utils/prompt-safety.js'
import { WEBHOOK_SECRET } from '../config.js'
import type { RouteContext } from './types.js'

// Webhook — public endpoint, de most shared-secret header védi.
// Korábban open volt + csak rate-limit (10/perc/IP). Security audit #1 szerint
// ez nem elég: prompt-injection Nova tmux-pane-re. A `X-Webhook-Secret` header
// kötelező, ha a WEBHOOK_SECRET env-változó be van állítva.
// Hard limits: body size (readBody), source whitelist, message length.

const SOURCE_RE = /^[a-zA-Z0-9_.-]{1,50}$/
const MAX_MSG_LEN = 2000

// Timing-safe secret compare. A karakterhossz különbséget is elfedjük —
// minden egyenlőségi ellenőrzés fix hosszú buffer-en fut.
function checkWebhookSecret(provided: string | undefined | string[]): boolean {
  if (!WEBHOOK_SECRET) return true  // ha nincs secret beállítva, open mód (legacy)
  if (!provided || Array.isArray(provided)) return false
  const expectedBuf = Buffer.from(WEBHOOK_SECRET)
  const providedBuf = Buffer.from(provided)
  if (expectedBuf.length !== providedBuf.length) return false
  return timingSafeEqual(expectedBuf, providedBuf)
}

export async function webhookRoutes(ctx: RouteContext): Promise<boolean> {
  const { path, method, req, res } = ctx

  if (path === '/api/webhook' && method === 'POST') {
    // Shared-secret auth
    if (!checkWebhookSecret(req.headers['x-webhook-secret'])) {
      json(res, { error: 'Unauthorized' }, 401)
      logger.warn({ ip: req.socket.remoteAddress }, 'Webhook: invalid or missing X-Webhook-Secret')
      return true
    }

    let payload: { source?: string; message?: string; [k: string]: unknown }
    try {
      const body = await readBody(req)
      payload = JSON.parse(body.toString())
    } catch {
      json(res, { error: 'Invalid JSON body' }, 400)
      return true
    }

    const rawSource = typeof payload.source === 'string' ? payload.source : 'unknown'
    const source = SOURCE_RE.test(rawSource) ? rawSource : 'unknown'

    const rawMessage = typeof payload.message === 'string' ? payload.message : JSON.stringify(payload)
    const message = rawMessage.slice(0, MAX_MSG_LEN)

    try {
      appendDailyLog('nova', `## ${new Date().toLocaleTimeString('hu-HU')} -- Webhook (${source})\n${message}`)
      if (message.length >= 40 && source !== 'unknown' && source !== 'test') saveAgentMemory('nova', `Webhook ${source}: ${message}`, 'cold', `webhook, ${source}`)
    } catch (err) {
      logger.warn({ err }, 'Webhook: log/memory save failed')
    }

    if (isAgentRunning('nova')) {
      // Prompt injection védelem: a kívülről érkező message <untrusted> tag-be
      // kerül, így a modell tudja, hogy nem instrukció. A source auth-less,
      // bárki POSTolhat ide.
      const wrapped = wrapUntrusted(`webhook:${source}`, message)
      const ok = sendToAgentSession('nova', `[Webhook @${source}]:\n${wrapped}`)
      if (!ok) logger.warn({ source }, 'Webhook: tmux inject failed')
    }

    json(res, { ok: true, received: true })
    return true
  }

  return false
}
