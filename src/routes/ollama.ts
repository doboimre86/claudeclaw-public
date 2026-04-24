import { OLLAMA_URL } from '../config.js'
import { json } from '../utils/http.js'
import type { RouteContext } from './types.js'

export async function ollamaRoutes(ctx: RouteContext): Promise<boolean> {
  const { path, method, res } = ctx

  if (path === '/api/ollama/models' && method === 'GET') {
    try {
      const resp = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(5000) })
      const data = await resp.json() as { models?: { name: string; size: number; details?: { parameter_size?: string } }[] }
      const models = (data.models || []).filter(m => !m.name.includes('embed')).map(m => ({
        name: m.name, size: Math.round(m.size / 1024 / 1024 / 1024 * 10) / 10 + ' GB', params: m.details?.parameter_size || '',
      }))
      json(res, models)
    } catch {
      json(res, [])
    }
    return true
  }

  return false
}
