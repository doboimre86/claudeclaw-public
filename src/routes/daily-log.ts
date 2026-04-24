import { appendDailyLog, getDailyLog, getDailyLogDates } from '../db.js'
import { readBody, json } from '../utils/http.js'
import type { RouteContext } from './types.js'

export async function dailyLogRoutes(ctx: RouteContext): Promise<boolean> {
  const { path, method, url, req, res } = ctx

  if (path === '/api/daily-log' && method === 'POST') {
    const body = await readBody(req)
    const data = JSON.parse(body.toString()) as { agent_id?: string; content: string }
    if (!data.content?.trim()) { json(res, { error: 'Content required' }, 400); return true }
    appendDailyLog(data.agent_id || 'nova', data.content.trim())
    json(res, { ok: true })
    return true
  }

  if (path === '/api/daily-log' && method === 'GET') {
    const agent = url.searchParams.get('agent') || 'nova'
    const date = url.searchParams.get('date') || new Date().toISOString().split('T')[0]
    json(res, getDailyLog(agent, date))
    return true
  }

  if (path === '/api/daily-log/dates' && method === 'GET') {
    json(res, getDailyLogDates(url.searchParams.get('agent') || 'nova'))
    return true
  }

  return false
}
