import { runDreamCycle, getLastDreamReport } from '../services/dreaming.js'
import { json } from '../utils/http.js'
import { logger } from '../logger.js'
import type { RouteContext } from './types.js'

export async function dreamingRoutes(ctx: RouteContext): Promise<boolean> {
  const { path, method, res } = ctx

  if (path === '/api/dream' && method === 'POST') {
    const agentId = ctx.url.searchParams.get('agent') || 'nova'
    try {
      const report = await runDreamCycle(agentId)
      json(res, { ok: true, report })
    } catch (err) {
      logger.error({ err }, 'Dream cycle API failed')
      json(res, { error: 'Dream cycle failed' }, 500)
    }
    return true
  }

  if (path === '/api/dream/status' && method === 'GET') {
    const report = getLastDreamReport()
    json(res, report || { message: 'No dream cycle has run yet' })
    return true
  }

  return false
}
