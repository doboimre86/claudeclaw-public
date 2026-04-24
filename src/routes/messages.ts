import {
  createAgentMessage, getPendingMessages, getAgentMessage,
  markMessageDone, markMessageFailed, listAgentMessages,
  type AgentMessage,
} from '../db.js'
import { logger } from '../logger.js'
import { readBody, json } from '../utils/http.js'
import { broadcastMessage } from '../services/message-router.js'
import type { RouteContext } from './types.js'

export async function messagesRoutes(ctx: RouteContext): Promise<boolean> {
  const { path, method, url, req, res } = ctx

  // Üzenet küldése
  if (path === '/api/messages' && method === 'POST') {
    const body = await readBody(req)
    const { from, to, content } = JSON.parse(body.toString()) as { from: string; to: string; content: string }
    if (!from?.trim() || !content?.trim()) {
      json(res, { error: 'from és content kötelező' }, 400)
      return true
    }

    // Broadcast: to=all → mindenkinek
    if (to === 'all') {
      const sent = broadcastMessage(from.trim(), content.trim())
      json(res, { ok: true, broadcast: true, sent })
      return true
    }

    if (!to?.trim()) {
      json(res, { error: 'to kötelező (vagy "all" broadcast-hoz)' }, 400)
      return true
    }

    const msg = createAgentMessage(from.trim(), to.trim(), content.trim())
    logger.info({ id: msg.id, from: msg.from_agent, to: msg.to_agent }, 'Agent üzenet létrehozva')
    json(res, msg)
    return true
  }

  // Üzenetek listázása
  if (path === '/api/messages' && method === 'GET') {
    const agent = url.searchParams.get('agent') || ''
    const status = url.searchParams.get('status') || ''
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 200)
    let messages: AgentMessage[]
    if (status === 'pending' && agent) messages = getPendingMessages(agent)
    else if (status === 'pending') messages = getPendingMessages()
    else messages = listAgentMessages(limit)
    if (agent && status !== 'pending') messages = messages.filter(m => m.from_agent === agent || m.to_agent === agent)
    json(res, messages)
    return true
  }

  // Válasz üzenetre (reply)
  const msgReplyMatch = path.match(/^\/api\/messages\/(\d+)\/reply$/)
  if (msgReplyMatch && method === 'POST') {
    const id = parseInt(msgReplyMatch[1], 10)
    const original = getAgentMessage(id)
    if (!original) { json(res, { error: 'Eredeti üzenet nem található' }, 404); return true }

    const body = await readBody(req)
    const { content } = JSON.parse(body.toString()) as { content: string }
    if (!content?.trim()) { json(res, { error: 'content kötelező' }, 400); return true }

    // Válasz: visszafelé (to → from)
    const reply = createAgentMessage(original.to_agent, original.from_agent, `[Válasz #${id}] ${content.trim()}`)
    // Eredeti üzenetet lezárjuk
    markMessageDone(id, `Válasz küldve: #${reply.id}`)

    logger.info({ originalId: id, replyId: reply.id, from: reply.from_agent, to: reply.to_agent }, 'Agent válasz küldve')
    json(res, reply)
    return true
  }

  // Üzenet státusz frissítés
  const msgUpdateMatch = path.match(/^\/api\/messages\/(\d+)$/)
  if (msgUpdateMatch && method === 'PUT') {
    const id = parseInt(msgUpdateMatch[1], 10)
    const body = await readBody(req)
    const { status: newStatus, result } = JSON.parse(body.toString()) as { status: string; result?: string }
    let ok = false
    if (newStatus === 'done') ok = markMessageDone(id, result)
    else if (newStatus === 'failed') ok = markMessageFailed(id, result)
    if (ok) { json(res, { ok: true }); return true }
    json(res, { error: 'Üzenet nem található vagy érvénytelen státusz' }, 404)
    return true
  }

  return false
}
