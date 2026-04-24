import { saveChatMessage, getChatHistory, clearChatHistory } from '../db.js'
import { runAgent } from '../agent.js'
import { logger } from '../logger.js'
import { readBody, json } from '../utils/http.js'
import type { RouteContext } from './types.js'

function sseWrite(res: import('node:http').ServerResponse, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

export async function chatRoutes(ctx: RouteContext): Promise<boolean> {
  const { path, method, url, req, res } = ctx

  // SSE streaming chat
  if (path === '/api/chat/stream' && method === 'POST') {
    const body = await readBody(req)
    const data = JSON.parse(body.toString()) as { message: string; sessionId?: string; agent?: string }
    if (!data.message) { json(res, { error: 'Message required' }, 400); return true }
    const agent = data.agent || 'nova'
    saveChatMessage(agent, 'user', data.message)

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    })

    // Security #27: SSE connection abort kezelése. A kliens megszakíthatja a
    // kapcsolatot (tab bezárás, navigáció), de a runAgent tovább futott →
    // CPU+token pazarlás DoS vektor. Most abort flag-et figyelünk és a chunk
    // callback-ben megszakítjuk a stream-et (a runAgent legközelebbi iter-
    // ációja már nem ír a response-ba).
    let clientAborted = false
    req.on('close', () => { clientAborted = true })
    req.on('aborted', () => { clientAborted = true })

    let fullText = ''

    try {
      const result = await runAgent(
        data.message,
        data.sessionId || undefined,
        undefined,
        (chunk) => {
          if (clientAborted) return  // ne írj le halott socketre
          fullText = chunk // assistant events contain full text, not deltas
          try { sseWrite(res, 'text', { text: chunk }) } catch { /* socket gone */ }
        }
      )
      if (!clientAborted) {
        const reply = result.text || fullText || 'Nincs válasz.'
        saveChatMessage(agent, 'assistant', reply, result.newSessionId)
        try { sseWrite(res, 'done', { reply, sessionId: result.newSessionId }) } catch {}
      } else {
        logger.info({ agent }, 'Chat stream: client aborted, reply NOT written')
      }
    } catch (err) {
      logger.error({ err }, 'Chat stream error')
      if (!clientAborted) {
        saveChatMessage(agent, 'system', 'Hiba a feldolgozás során')
        try { sseWrite(res, 'error', { error: 'Hiba a feldolgozás során' }) } catch {}
      }
    }

    if (!clientAborted) res.end()
    return true
  }

  // Regular (non-streaming) chat
  if (path === '/api/chat' && method === 'POST') {
    const body = await readBody(req)
    const data = JSON.parse(body.toString()) as { message: string; sessionId?: string; agent?: string }
    if (!data.message) { json(res, { error: 'Message required' }, 400); return true }
    const agent = data.agent || 'nova'
    saveChatMessage(agent, 'user', data.message)
    try {
      const result = await runAgent(data.message, data.sessionId || undefined)
      const reply = result.text || 'Nincs válasz.'
      saveChatMessage(agent, 'assistant', reply, result.newSessionId)
      json(res, { ok: true, reply, sessionId: result.newSessionId })
    } catch (err) {
      logger.error({ err }, 'Chat error')
      saveChatMessage(agent, 'system', 'Hiba a feldolgozás során')
      json(res, { error: 'Hiba a feldolgozás során' }, 500)
    }
    return true
  }

  if (path === '/api/chat/history' && method === 'GET') {
    const agent = url.searchParams.get('agent') || 'nova'
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 200)
    const messages = getChatHistory(agent, limit).reverse()
    json(res, messages)
    return true
  }

  if (path === '/api/chat/history' && method === 'DELETE') {
    const agent = url.searchParams.get('agent') || 'nova'
    const deleted = clearChatHistory(agent)
    json(res, { ok: true, deleted })
    return true
  }

  return false
}
