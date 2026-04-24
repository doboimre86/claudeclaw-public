import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'

const execAsync = promisify(exec)
import { logger } from '../logger.js'
import { readBody, json } from '../utils/http.js'
import { sanitizeAgentName } from '../utils/sanitize.js'
import { shellEscape } from '../utils/shell.js'
import { AGENTS_BASE_DIR } from '../services/agent-manager.js'
import type { RouteContext } from './types.js'

let connectorCache: { data: any; ts: number } | null = null

export async function connectorsRoutes(ctx: RouteContext): Promise<boolean> {
  const { path, method, req, res } = ctx

  if (path === '/api/connectors' && method === 'GET') {
    if (connectorCache && (Date.now() - connectorCache.ts) < 300_000) { json(res, connectorCache.data); return true }
    const connectors: any[] = []
    // 1. Project .mcp.json
    try {
      const mcpPath = join(AGENTS_BASE_DIR, '..', '.mcp.json')
      if (existsSync(mcpPath)) {
        const mcpConfig = JSON.parse(readFileSync(mcpPath, 'utf-8'))
        for (const [name, config] of Object.entries(mcpConfig.mcpServers || {})) {
          const cfg = config as any; const endpoint = cfg.url || cfg.command || 'local'
          connectors.push({ name, status: 'configured', endpoint, type: typeof cfg.url === 'string' ? 'remote' : 'local' })
        }
      }
    } catch {}
    // 2. Read MCP list cache file (populated by cron or manual run)
    try {
      const cacheFile = join(AGENTS_BASE_DIR, '..', 'store', 'mcp-list-cache.txt')
      if (existsSync(cacheFile)) {
        const lines = readFileSync(cacheFile, 'utf-8').split('\n').filter(l => l.trim() && !l.startsWith('Checking'))
        for (const line of lines) {
          const match = line.match(/^(.+?):\s+(.+)\s+-\s+(.+)$/)
          if (!match) continue
          const name = match[1].trim(); const endpoint = match[2].trim(); const statusText = match[3].trim()
          let status = 'unknown'
          if (statusText.includes('Connected')) status = 'connected'
          else if (statusText.includes('Needs auth') || statusText.includes('authentication')) status = 'needs_auth'
          else if (statusText.includes('Failed')) status = 'failed'
          if (!connectors.some((x: any) => x.name === name)) {
            connectors.push({ name, status, endpoint, type: endpoint.startsWith('http') ? 'remote' : 'local' })
          }
        }
      }
    } catch {}
    // 3. Enabled plugins from settings
    try {
      const settingsPath = join('/root/.nova-claude', '.claude', 'settings.json')
      if (existsSync(settingsPath)) {
        const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'))
        for (const [name, enabled] of Object.entries(settings.enabledPlugins || {})) {
          if (enabled && !connectors.some((x: any) => x.name === name)) {
            connectors.push({ name, status: 'connected', endpoint: 'plugin', type: 'plugin' })
          }
        }
      }
    } catch {}
    connectorCache = { data: connectors, ts: Date.now() }
    json(res, connectors); return true
  }

  
  const connectorDetailMatch = path.match(/^\/api\/connectors\/(.+)$/)
  if (connectorDetailMatch && method === 'GET' && !path.includes('/assign')) {
    const name = decodeURIComponent(connectorDetailMatch[1])
    try {
      // Use Nova's HOME so claude mcp picks up the same config + connection state Nova sees.
      // Without this, the service-user (root) HOME has no connected MCP servers.
      const execResult = await execAsync(`claude mcp get ${shellEscape(name)} 2>&1`, {
        timeout: 15000,
        encoding: 'utf-8',
        env: { ...process.env, HOME: '/root/.nova-claude' },
      }).catch((e: any) => ({ stdout: '', stderr: e.stdout || e.message || String(e) }))
      const output = (execResult.stdout || execResult.stderr || '') as string
      const scope = output.match(/Scope:\s+(.+)/)?.[1]?.trim() || ''
      const statusLine = output.match(/Status:\s+(.+)/)?.[1]?.trim().toLowerCase() ?? ''
      let status: string
      if (statusLine.includes('connected')) status = 'connected'
      else if (statusLine.includes('needs') || statusLine.includes('auth')) status = 'needs_auth'
      else if (statusLine.includes('fail')) status = 'failed'
      else status = output.match(/Status:/) ? 'unknown' : 'failed' 
      const type = output.match(/Type:\s+(.+)/)?.[1]?.trim() || ''
      const command = output.match(/Command:\s+(.+)/)?.[1]?.trim() || ''
      const args = output.match(/Args:\s+(.+)/)?.[1]?.trim() || ''
      const envLines = output.split('\n').filter((l: string) => l.match(/^\s{4}\w+=/))
      const env: Record<string, string> = {}
      for (const el of envLines) { const [k] = el.trim().split('='); env[k] = '***' }
      json(res, { name, scope, status, type, command, args, env })
    } catch {
      json(res, { error: 'Connector not found' }, 404)
    }
    return true
  }

  if (path === '/api/connectors' && method === 'POST') {
    connectorCache = null
    const body = await readBody(req)
    const data = JSON.parse(body.toString()) as { name: string; type: 'remote' | 'local'; url?: string; command?: string; args?: string; scope?: string; env?: Record<string, string> }
    if (!data.name?.trim()) { json(res, { error: 'Name is required' }, 400); return true }
    try {
      const scopeFlag = data.scope === 'project' ? '-s project' : '-s user'
      if (data.type === 'remote' && data.url) {
        await execAsync(`claude mcp add --transport http ${scopeFlag} ${shellEscape(data.name)} ${shellEscape(data.url)} 2>&1`, { timeout: 15000, encoding: 'utf-8' })
      } else if (data.type === 'local' && data.command) {
        const envFlags = data.env ? Object.entries(data.env).map(([k, v]) => `-e ${shellEscape(k)}=${shellEscape(v)}`).join(' ') : ''
        const argsStr = data.args ? shellEscape(data.args) : ''
        await execAsync(`claude mcp add ${scopeFlag} ${envFlags} ${shellEscape(data.name)} -- ${shellEscape(data.command)} ${argsStr} 2>&1`, { timeout: 15000, encoding: 'utf-8' })
      } else { json(res, { error: 'URL (remote) or command (local) required' }, 400); return true }
      json(res, { ok: true })
    } catch (err: any) {
      json(res, { error: err.message || 'Failed to add connector' }, 500)
    }
    return true
  }

  if (connectorDetailMatch && method === 'DELETE' && !path.includes('/assign')) {
    connectorCache = null
    const name = decodeURIComponent(connectorDetailMatch[1])
    try {
      try { await execAsync(`claude mcp remove ${shellEscape(name)} -s project 2>&1`, { timeout: 10000 }) }
      catch { await execAsync(`claude mcp remove ${shellEscape(name)} -s user 2>&1`, { timeout: 10000 }) }
      json(res, { ok: true })
    } catch {
      json(res, { error: 'Failed to remove connector' }, 500)
    }
    return true
  }

  const connectorAssignMatch = path.match(/^\/api\/connectors\/(.+)\/assign$/)
  if (connectorAssignMatch && method === 'POST') {
    const connectorName = decodeURIComponent(connectorAssignMatch[1])
    const body = await readBody(req)
    const { agents: targetAgents } = JSON.parse(body.toString()) as { agents: string[] }
    let connectorConfig: any = null
    try {
      const { stdout: output } = await execAsync(`claude mcp get ${shellEscape(connectorName)} 2>&1`, { timeout: 15000, encoding: 'utf-8' })
      connectorConfig = { command: output.match(/Command:\s+(.+)/)?.[1]?.trim(), args: output.match(/Args:\s+(.+)/)?.[1]?.trim(), url: output.match(/https?:\/\/[^\s]+/)?.[0] }
    } catch { json(res, { error: 'Connector not found' }, 404); return true }
    for (const rawAgent of targetAgents) { const agentName = sanitizeAgentName(rawAgent); if (!agentName) continue;
      const mcpPath = join(AGENTS_BASE_DIR, agentName, '.mcp.json')
      if (!existsSync(mcpPath)) continue
      let mcpConfig: any = {}
      try { mcpConfig = JSON.parse(readFileSync(mcpPath, 'utf-8')) } catch {}
      if (!mcpConfig.mcpServers) mcpConfig.mcpServers = {}
      if (connectorConfig.url) mcpConfig.mcpServers[connectorName] = { type: 'http', url: connectorConfig.url }
      else if (connectorConfig.command) mcpConfig.mcpServers[connectorName] = { command: connectorConfig.command, args: connectorConfig.args ? connectorConfig.args.split(/\s+/) : [] }
      writeFileSync(mcpPath, JSON.stringify(mcpConfig, null, 2))
    }
    json(res, { ok: true })
    return true
  }

  return false
}
