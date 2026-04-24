import { existsSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { CronExpressionParser } from 'cron-parser'
import { logger } from '../logger.js'
import { runAgent } from '../agent.js'
import { readBody, json } from '../utils/http.js'
import { listAgentNames } from '../services/agent-manager.js'
import { readFileOr } from '../services/agent-manager.js'
import {
  SCHEDULED_TASKS_DIR,
  listScheduledTasks, sanitizeScheduleName, writeScheduledTask,
  listQueuedTasks,
} from '../services/scheduler.js'
import type { RouteContext } from './types.js'

// 5-mezős (standard) és 6-mezős (másodperc-pontos) cron elfogadása.
// Bármi más — túl hosszú string, random írásjel, üres mezők — 400-nál
// visszautasítva, mielőtt a parser a scheduler loop mélyébe jutna.
// Upstream #19 ihletésre.
const CRON_SHAPE_RX = /^(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)(?:\s+(\S+))?$/

function isValidCronShape(cron: unknown): cron is string {
  if (typeof cron !== 'string') return false
  const trimmed = cron.trim()
  if (!trimmed || trimmed.length > 100) return false
  if (!CRON_SHAPE_RX.test(trimmed)) return false
  try {
    const expr = CronExpressionParser.parse(trimmed)
    expr.next()
    return true
  } catch {
    return false
  }
}

export async function schedulesRoutes(ctx: RouteContext): Promise<boolean> {
  const { path, method, req, res } = ctx

  if (path === '/api/schedules/agents' && method === 'GET') {
    const agentNames = listAgentNames()
    const agents = [
      { name: 'nova', label: 'Nova', avatar: '/api/nova/avatar' },
      ...agentNames.map(n => ({ name: n, label: n.charAt(0).toUpperCase() + n.slice(1), avatar: `/api/agents/${encodeURIComponent(n)}/avatar` }))
    ]
    json(res, agents)
    return true
  }

  if (path === '/api/schedules/expand-questions' && method === 'POST') {
    const body = await readBody(req)
    const { prompt, agent } = JSON.parse(body.toString()) as { prompt: string; agent?: string }
    if (!prompt?.trim()) { json(res, { error: 'Prompt is required' }, 400); return true }
    const aiPrompt = `A felhasznalo egy utemezett feladatot akar letrehozni egy AI agensnek. A rovid leirasa:\n"${prompt.trim()}"\n${agent ? `Az agens neve: ${agent}` : ''}\n\nGeneralj 3-4 feleletvalasztos kerdest, amivel pontositani lehet a feladatot. Minden kerdeshez adj 2-4 valaszlehetoseget.\n\nValaszolj KIZAROLAG JSON formatumban, semmi mas:\n[\n  {"question": "Kerdes szovege?", "options": ["Opcio 1", "Opcio 2", "Opcio 3"]},\n  {"question": "Masik kerdes?", "options": ["A", "B"]}\n]`
    try {
      const { text } = await runAgent(aiPrompt)
      if (!text) throw new Error('No response')
      const jsonMatch = text.match(/\[[\s\S]*\]/)
      if (!jsonMatch) throw new Error('Invalid response format')
      json(res, JSON.parse(jsonMatch[0]))
    } catch (err) {
      logger.error({ err }, 'Failed to generate expand questions')
      json(res, { error: 'Failed to generate questions' }, 500)
    }
    return true
  }

  if (path === '/api/schedules/expand-prompt' && method === 'POST') {
    const body = await readBody(req)
    const { prompt, answers } = JSON.parse(body.toString()) as { prompt: string; answers: { question: string; answer: string }[] }
    if (!prompt?.trim()) { json(res, { error: 'Prompt is required' }, 400); return true }
    const answersText = answers.map((a) => `Kerdes: ${a.question}\nValasz: ${a.answer}`).join('\n\n')
    const aiPrompt = `Bovitsd ki ezt a rovid feladat-leirast egy reszletes, egyertelmu promptta amit egy AI asszisztens vegre tud hajtani.\nA prompt legyen magyar nyelvu, konkret utasitasokkal.\n\nRovid leiras: "${prompt.trim()}"\n\nA felhasznalo valaszai a pontosito kerdesekre:\n${answersText}\n\nAz eredmeny CSAK a kibovitett prompt szovege legyen, semmi mas. Ne hasznalj code fence-t.`
    try {
      const { text } = await runAgent(aiPrompt)
      if (!text) throw new Error('No response')
      let expanded = text.trim()
      if (expanded.startsWith('```')) expanded = expanded.replace(/^```\w*\n?/, '').replace(/\n?```$/, '')
      json(res, { prompt: expanded })
    } catch (err) {
      logger.error({ err }, 'Failed to expand prompt')
      json(res, { error: 'Failed to expand prompt' }, 500)
    }
    return true
  }

  if (path === '/api/schedules' && method === 'GET') {
    json(res, listScheduledTasks())
    return true
  }

  // Upstream #36 parity: pending queue listázása (dashboard UI-hoz).
  // Minden item: ki vár, mióta, hányszor próbáltunk, volt-e 1h riadó.
  if (path === '/api/schedules/pending' && method === 'GET') {
    const now = Date.now()
    const queued = listQueuedTasks().map(({ item }) => ({
      taskName: item.taskName,
      agentName: item.agentName,
      session: item.session,
      type: item.type,
      queuedAt: item.queuedAt,
      ageMs: now - item.queuedAt,
      retries: item.retries,
      maxAgeMs: item.maxAge,
      alertSent: !!item.alertSentAt,
      alertSentAt: item.alertSentAt ?? null,
    }))
    json(res, queued)
    return true
  }

  if (path === '/api/schedules' && method === 'POST') {
    const body = await readBody(req)
    const data = JSON.parse(body.toString()) as { name: string; description: string; prompt: string; schedule: string; agent?: string; type?: string }
    const name = sanitizeScheduleName(data.name || '')
    if (!name) { json(res, { error: 'Name is required' }, 400); return true }
    if (!data.prompt?.trim()) { json(res, { error: 'Prompt is required' }, 400); return true }
    if (!data.schedule?.trim()) { json(res, { error: 'Schedule is required' }, 400); return true }
    if (!isValidCronShape(data.schedule)) { json(res, { error: 'Invalid cron expression' }, 400); return true }
    const dir = join(SCHEDULED_TASKS_DIR, name)
    if (existsSync(dir)) { json(res, { error: 'Schedule already exists' }, 409); return true }
    writeScheduledTask(name, { description: data.description || '', prompt: data.prompt.trim(), schedule: data.schedule.trim(), agent: data.agent || 'nova', enabled: true, type: data.type || 'task' })
    logger.info({ name, schedule: data.schedule }, 'Scheduled task created')
    json(res, { ok: true, name })
    return true
  }

  const scheduleUpdateMatch = path.match(/^\/api\/schedules\/([^/]+)$/)
  if (scheduleUpdateMatch && method === 'PUT') {
    // Path traversal védelem: sanitizeScheduleName-et minden művelet elején
    const name = sanitizeScheduleName(decodeURIComponent(scheduleUpdateMatch[1]))
    if (!name) { json(res, { error: 'Invalid schedule name' }, 400); return true }
    const dir = join(SCHEDULED_TASKS_DIR, name)
    if (!existsSync(dir)) { json(res, { error: 'Schedule not found' }, 404); return true }
    const body = await readBody(req)
    const data = JSON.parse(body.toString()) as { description?: string; prompt?: string; schedule?: string; agent?: string; enabled?: boolean }
    if (data.schedule !== undefined && !isValidCronShape(data.schedule)) {
      json(res, { error: 'Invalid cron expression' }, 400); return true
    }
    writeScheduledTask(name, data)
    logger.info({ name }, 'Scheduled task updated')
    json(res, { ok: true })
    return true
  }

  if (scheduleUpdateMatch && method === 'DELETE') {
    const name = sanitizeScheduleName(decodeURIComponent(scheduleUpdateMatch[1]))
    if (!name) { json(res, { error: 'Invalid schedule name' }, 400); return true }
    const dir = join(SCHEDULED_TASKS_DIR, name)
    if (!existsSync(dir)) { json(res, { error: 'Schedule not found' }, 404); return true }
    rmSync(dir, { recursive: true, force: true })
    logger.info({ name }, 'Scheduled task deleted')
    json(res, { ok: true })
    return true
  }

  const scheduleToggleMatch = path.match(/^\/api\/schedules\/([^/]+)\/toggle$/)
  if (scheduleToggleMatch && method === 'POST') {
    const name = sanitizeScheduleName(decodeURIComponent(scheduleToggleMatch[1]))
    if (!name) { json(res, { error: 'Invalid schedule name' }, 400); return true }
    const dir = join(SCHEDULED_TASKS_DIR, name)
    if (!existsSync(dir)) { json(res, { error: 'Schedule not found' }, 404); return true }
    const configPath = join(dir, 'task-config.json')
    let config: Record<string, unknown> = {}
    try { config = JSON.parse(readFileOr(configPath, '{}')) } catch {}
    const newEnabled = !(config.enabled !== false)
    config.enabled = newEnabled
    writeFileSync(configPath, JSON.stringify(config, null, 2))
    logger.info({ name, enabled: newEnabled }, 'Scheduled task toggled')
    json(res, { ok: true, enabled: newEnabled })
    return true
  }

  return false
}
