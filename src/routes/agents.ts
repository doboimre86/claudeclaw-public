import { existsSync, writeFileSync, readdirSync, unlinkSync, mkdirSync, rmSync, statSync, lstatSync, copyFileSync } from 'node:fs'
import { join, extname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { execSync } from 'node:child_process'
import { ALLOWED_CHAT_ID } from '../config.js'
import { createAgentMessage } from '../db.js'
import { PROJECT_ROOT } from '../config.js'
import { logger } from '../logger.js'
import { readBody, json } from '../utils/http.js'
import { sanitizeAgentName, sanitizeSkillName, safeJoin } from '../utils/sanitize.js'
import { isAgentRunning, agentSessionName } from '../utils/shell.js'
import { parseMultipart } from '../utils/multipart.js'
import {
  AGENTS_BASE_DIR, DEFAULT_MODEL,
  agentDir, findAvatarForAgent,
  writeAgentModel, writeAgentProfile, getAgentDetail, listAgentNames, listAgentSummaries,
  scaffoldAgentDir, startAgentProcess, stopAgentProcess,
  generateClaudeMd, generateSoulMd, generateSkillMd,
  readFileOr,
} from '../services/agent-manager.js'
import {
  validateTelegramToken, parseTelegramToken,
  sendWelcomeMessage, sendAvatarChangeMessage,
} from '../services/telegram.js'
import { serveFile } from '../utils/http.js'
import type { RouteContext } from './types.js'
import { getOrCreateAvatarThumb, invalidateThumbsForSource } from '../utils/thumbnail.js'
import { getAgentMood, recordFeedback, MOOD_EMOJI } from '../services/mood.js'

const WEB_DIR = join(AGENTS_BASE_DIR, '..', 'web')

function getAgentProcessInfo(name: string): { running: boolean; session?: string } {
  const running = isAgentRunning(name)
  if (!running) return { running: false }
  return { running: true, session: agentSessionName(name) }
}

export async function agentsRoutes(ctx: RouteContext): Promise<boolean> {
  const { path, method, req, res, url } = ctx

  // List available security profiles (for UI dropdown on new agent creation)
  if (path === '/api/profiles' && method === 'GET') {
    const { listProfiles } = await import('../services/profiles.js')
    json(res, listProfiles())
    return true
  }

  // Név ötletek generálása AI-val a leírás alapján
  // POST /api/agents/name-suggest { description, count? } → { suggestions: string[] }
  if (path === '/api/agents/name-suggest' && method === 'POST') {
    const body = await readBody(req)
    let description = '', count = 6
    try {
      const parsed = JSON.parse(body.toString() || '{}')
      description = typeof parsed.description === 'string' ? parsed.description.slice(0, 1000) : ''
      count = Math.min(Math.max(parseInt(parsed.count, 10) || 6, 3), 10)
    } catch { /* empty body OK */ }
    if (!description.trim()) {
      json(res, { error: 'Leírás kötelező a név ötletekhez' }, 400); return true
    }
    // Gemini-t használjuk (már kulcsunk van, independent a Claude Code SDK-tól)
    const geminiKey = process.env.GEMINI_API_KEY
    if (!geminiKey) { json(res, { error: 'GEMINI_API_KEY not configured' }, 500); return true }
    try {
      const prompt = `Adj ${count} kreatív magyar nevet egy AI agentnek az alábbi leírás alapján. A név lehet személynév (pl. Luna, Max, Bence), funkcionális név (pl. "email-iro", "piackutato"), vagy fantázianév (pl. Quillo, Hermes). Legyen rövid (max 20 karakter), magyarul olvasható, ékezetek OK.

Leírás: ${description}

Válasz formátum: pontosan ${count} név, soronként egy, semmi más szöveg. Nincs számozás, nincs kommentár, nincs ismétlés.`
      const apiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      })
      if (!apiRes.ok) {
        const errText = await apiRes.text()
        logger.warn({ status: apiRes.status, errText: errText.slice(0, 300) }, 'Gemini name-suggest error')
        json(res, { error: `Gemini API: HTTP ${apiRes.status}` }, 502); return true
      }
      const data = await apiRes.json() as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
      }
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || ''
      if (!text) { json(res, { error: 'Gemini üres válasz' }, 502); return true }
      const suggestions = text.split('\n')
        .map((l: string) => l.replace(/^[\s\d.•*\-]+/, '').trim())
        .filter((l: string) => l.length > 0 && l.length <= 30 && !/^(név|name):/i.test(l))
        .slice(0, count)
      json(res, { suggestions })
    } catch (err) {
      logger.error({ err }, 'Name suggest failed')
      json(res, { error: 'Név ötlet generálás sikertelen' }, 500)
    }
    return true
  }

  // Agent templates CRUD (templates/agents/*.json)
  const templatesDir = join(PROJECT_ROOT, 'templates', 'agents')
  const TPL_ID_RE = /^[a-z0-9][a-z0-9_-]{0,40}$/i  // path-traversal + sanity

  // LIST
  if (path === '/api/agent-templates' && method === 'GET') {
    if (!existsSync(templatesDir)) { json(res, []); return true }
    try {
      const list = readdirSync(templatesDir)
        .filter(f => f.endsWith('.json'))
        .map(f => {
          try {
            return JSON.parse(readFileOr(join(templatesDir, f), '{}'))
          } catch { return null }
        })
        .filter(Boolean)
      json(res, list)
    } catch (err) {
      logger.warn({ err }, 'agent-templates list failed')
      json(res, [])
    }
    return true
  }

  // CREATE / UPDATE — POST /api/agent-templates (id a body-ban)
  if (path === '/api/agent-templates' && method === 'POST') {
    const body = await readBody(req)
    let data: Record<string, unknown>
    try { data = JSON.parse(body.toString()) } catch { json(res, { error: 'Invalid JSON' }, 400); return true }
    const id = String(data.id || '').trim()
    if (!TPL_ID_RE.test(id)) { json(res, { error: 'Invalid id (csak a-z 0-9 _ -, max 40)' }, 400); return true }
    // Strict allowlist a mezőknek — ne engedjünk át random kulcsot
    const allowed: Record<string, unknown> = { id }
    const strFields = ['icon', 'label', 'name', 'description', 'profile', 'model', 'avatarStyle']
    for (const k of strFields) {
      if (typeof data[k] === 'string') allowed[k] = (data[k] as string).slice(0, 1000)
    }
    if (!allowed.label || !allowed.name || !allowed.description) {
      json(res, { error: 'label, name, description kötelező' }, 400); return true
    }
    try {
      mkdirSync(templatesDir, { recursive: true })
      const filePath = safeJoin(templatesDir, `${id}.json`)
      writeFileSync(filePath, JSON.stringify(allowed, null, 2) + '\n')
      json(res, { ok: true, id })
    } catch (err) {
      logger.warn({ err, id }, 'agent-template write failed')
      json(res, { error: 'Write failed' }, 500)
    }
    return true
  }

  // DELETE — DELETE /api/agent-templates/:id
  const templateDeleteMatch = path.match(/^\/api\/agent-templates\/([^/]+)$/)
  if (templateDeleteMatch && method === 'DELETE') {
    const id = decodeURIComponent(templateDeleteMatch[1])
    if (!TPL_ID_RE.test(id)) { json(res, { error: 'Invalid id' }, 400); return true }
    try {
      const filePath = safeJoin(templatesDir, `${id}.json`)
      if (existsSync(filePath)) unlinkSync(filePath)
      json(res, { ok: true })
    } catch (err) {
      logger.warn({ err, id }, 'agent-template delete failed')
      json(res, { error: 'Delete failed' }, 500)
    }
    return true
  }

  // List agents
  if (path === '/api/agents' && method === 'GET') {
    // Enrich with mood — Nova rendered separately by frontend, do NOT add here
    const enriched = listAgentSummaries().map(a => ({ ...a, mood: getAgentMood(a.name) }))
    json(res, enriched)
    return true
  }

  if (path === '/api/mood' && method === 'GET') {
    const agents = ['nova', ...listAgentSummaries().map(a => a.name)]
    json(res, agents.map(a => ({ agent: a, ...getAgentMood(a), emoji: MOOD_EMOJI[getAgentMood(a).mood] })))
    return true
  }

  const moodMatch = path.match(/^\/api\/mood\/([^/]+)$/)
  if (moodMatch && method === 'GET') {
    const agent = decodeURIComponent(moodMatch[1])
    const state = getAgentMood(agent)
    json(res, { ...state, emoji: MOOD_EMOJI[state.mood] })
    return true
  }

  const feedbackMatch = path.match(/^\/api\/mood\/([^/]+)\/feedback$/)
  if (feedbackMatch && method === 'POST') {
    const agent = decodeURIComponent(feedbackMatch[1])
    const body = await readBody(req)
    const { text } = JSON.parse(body.toString()) as { text: string }
    if (!text?.trim()) { json(res, { error: 'text required' }, 400); return true }
    const state = recordFeedback(agent, text.trim())
    json(res, { ...state, emoji: MOOD_EMOJI[state.mood] })
    return true
  }

  // Create agent
  if (path === '/api/agents' && method === 'POST') {
    const body = await readBody(req)
    const data = JSON.parse(body.toString())
    const { description, model: rawModel, profile: rawProfile } = data as { name: string; description: string; model?: string; profile?: string }
    const name = sanitizeAgentName(data.name || '')
    const model = rawModel || DEFAULT_MODEL
    // Profile ID validáció (path-traversal védelem) — csak a-z, 0-9, -, _
    const profile = typeof rawProfile === 'string' && /^[a-z0-9_-]+$/i.test(rawProfile) ? rawProfile : undefined
    if (!name) { json(res, { error: 'Name is required' }, 400); return true }
    if (!description) { json(res, { error: 'Description is required' }, 400); return true }
    if (existsSync(agentDir(name))) { json(res, { error: 'Agent already exists' }, 409); return true }
    scaffoldAgentDir(name, profile)
    writeAgentModel(name, model)
    if (profile) writeAgentProfile(name, profile)
    logger.info({ name, description }, 'Generating agent CLAUDE.md and SOUL.md...')
    try {
      const [claudeMd, soulMd] = await Promise.all([
        generateClaudeMd(name, description, model),
        generateSoulMd(name, description),
      ])
      writeFileSync(join(agentDir(name), 'CLAUDE.md'), claudeMd)
      writeFileSync(join(agentDir(name), 'SOUL.md'), soulMd)
      logger.info({ name }, 'Agent created successfully')
      const allAgents = listAgentNames()
      const runningAgents = allAgents.filter(a => a !== name && isAgentRunning(a))
      const notifyTargets = ['nova', ...runningAgents]
      for (const target of notifyTargets) {
        createAgentMessage('system', target, `Uj csapattag erkezett: ${name}. Leirasa: ${description}. Udv neki ha legkozelebb beszeltek!`)
      }
    } catch (err) {
      rmSync(agentDir(name), { recursive: true, force: true })
      logger.error({ err, name }, 'Failed to generate agent files')
      json(res, { error: 'Failed to generate agent files' }, 500)
      return true
    }
    json(res, { ok: true, name })
    return true
  }

  // Avatar AI PREVIEW generálás — agent létrehozása nélkül, data URL-t ad vissza.
  // Wizard step 1-ben használható: a user generálhat, megnézheti, újrápróbálhatja,
  // és csak az "Ezt használom" kattintáskor lesz végleges (a create endpoint
  // feltölti az avatar-t az agent létrejötte után).
  // POST /api/avatar/preview { name?, description?, style?, prompt? }
  // → { dataUrl: "data:image/png;base64,..." }
  if (path === '/api/avatar/preview' && method === 'POST') {
    const body = await readBody(req)
    let name = '', description = '', style: string | undefined, userPrompt: string | undefined
    try {
      const parsed = JSON.parse(body.toString() || '{}')
      name = typeof parsed.name === 'string' ? parsed.name.slice(0, 100) : ''
      description = typeof parsed.description === 'string' ? parsed.description.slice(0, 500) : ''
      style = typeof parsed.style === 'string' ? parsed.style.slice(0, 80) : undefined
      userPrompt = typeof parsed.prompt === 'string' ? parsed.prompt.slice(0, 800) : undefined
    } catch { /* üres OK */ }

    const geminiKey = process.env.GEMINI_API_KEY
    if (!geminiKey) { json(res, { error: 'GEMINI_API_KEY not configured' }, 500); return true }

    // Style → stílus hint mapping
    const STYLE_HINTS: Record<string, string> = {
      'photorealistic': 'professional photorealistic portrait, warm studio lighting, shallow depth of field',
      'cartoon': 'friendly cartoon illustration style, warm colors, soft lines',
      'pixel-art': '8-bit pixel art style, retro game character, limited palette, sharp pixels',
      'anime': 'anime / manga style portrait, soft shading, expressive eyes',
      'minimal': 'minimalist flat vector illustration, geometric shapes, limited color palette',
      '3d': '3D rendered CGI portrait, Pixar-style, polished materials, soft lighting',
      'oil-painting': 'oil painting portrait, classical fine-art style, visible brush strokes',
    }
    const styleHint = (style && STYLE_HINTS[style]) || STYLE_HINTS['photorealistic']
    const safeName = name || 'AI assistant'
    const imagePrompt = userPrompt ||
      `Square avatar for an AI assistant persona named "${safeName}". ${styleHint}. Head and shoulders, friendly expression, clean neutral background, 1024x1024. Persona context: ${description || 'general helpful assistant'}`

    try {
      const apiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${geminiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: imagePrompt }] }],
          generationConfig: { responseModalities: ['IMAGE'] },
        }),
      })
      if (!apiRes.ok) {
        const errText = await apiRes.text()
        logger.warn({ status: apiRes.status, errText: errText.slice(0, 300) }, 'Gemini image preview API error')
        json(res, { error: `Gemini API: HTTP ${apiRes.status}` }, 502)
        return true
      }
      const data = await apiRes.json() as {
        candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string }; text?: string }> } }>
      }
      const parts = data?.candidates?.[0]?.content?.parts || []
      const imgPart = parts.find((p) => p.inlineData?.data)
      if (!imgPart?.inlineData?.data) {
        json(res, { error: 'Gemini returned no image (policy blocked or empty)' }, 502)
        return true
      }
      const mimeType = imgPart.inlineData.mimeType || 'image/png'
      const base64 = imgPart.inlineData.data
      json(res, { dataUrl: `data:${mimeType};base64,${base64}`, size: Math.floor(base64.length * 0.75), prompt: imagePrompt.slice(0, 200) })
      return true
    } catch (err) {
      logger.error({ err }, 'Avatar preview generation failed')
      json(res, { error: 'Avatar preview failed: ' + (err instanceof Error ? err.message : String(err)) }, 500)
      return true
    }
  }

  // Avatar AI generálás (Gemini 2.5 Flash Image "Nano Banana")
  // POST /api/agents/:name/avatar/generate { prompt?: string }
  // Gemini-hez hív, az eredmény base64 PNG-t avatar.png-ként menti.
  const avatarGenMatch = path.match(/^\/api\/agents\/([^/]+)\/avatar\/generate$/)
  if (avatarGenMatch && method === 'POST') {
    const name = sanitizeAgentName(decodeURIComponent(avatarGenMatch[1]))
    if (!existsSync(agentDir(name))) { json(res, { error: 'Agent not found' }, 404); return true }
    const body = await readBody(req)
    let userPrompt: string | undefined
    let style: string | undefined
    try {
      const parsed = JSON.parse(body.toString() || '{}')
      userPrompt = typeof parsed.prompt === 'string' ? parsed.prompt : undefined
      style = typeof parsed.style === 'string' ? parsed.style : undefined
    } catch { /* üres body OK */ }

    const geminiKey = process.env.GEMINI_API_KEY
    if (!geminiKey) { json(res, { error: 'GEMINI_API_KEY not configured in .env' }, 500); return true }

    const claudeMd = readFileOr(join(agentDir(name), 'CLAUDE.md'), '')
    const description = claudeMd.split('\n').filter(l => l.trim() && !l.startsWith('#')).slice(0, 3).join(' ').slice(0, 300)
    const styleHint = style || 'professional photorealistic portrait, warm studio lighting, shallow depth of field, 1024x1024'
    const imagePrompt = userPrompt ||
      `Square avatar for an AI assistant persona named "${name}". ${styleHint}. Head and shoulders, friendly expression, clean neutral background. Persona context: ${description}`

    try {
      const apiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${geminiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: imagePrompt }] }],
          generationConfig: { responseModalities: ['IMAGE'] },
        }),
      })
      if (!apiRes.ok) {
        const errText = await apiRes.text()
        logger.warn({ name, status: apiRes.status, errText: errText.slice(0, 300) }, 'Gemini image API error')
        json(res, { error: `Gemini API: HTTP ${apiRes.status}` }, 502)
        return true
      }
      const data = await apiRes.json() as {
        candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string }; text?: string }> } }>
      }
      const parts = data?.candidates?.[0]?.content?.parts || []
      const imgPart = parts.find((p) => p.inlineData?.data)
      if (!imgPart?.inlineData?.data) {
        const text = parts.find((p) => p.text)?.text
        logger.warn({ name, responseText: text?.slice(0, 200) }, 'Gemini returned no image')
        json(res, { error: 'Gemini returned no image (policy blocked or empty)' }, 502)
        return true
      }
      const imgBuffer = Buffer.from(imgPart.inlineData.data, 'base64')

      // Régi avatar törlés + új mentés
      for (const ext of ['.png', '.jpg', '.jpeg', '.webp']) {
        const p = join(agentDir(name), `avatar${ext}`)
        if (existsSync(p)) unlinkSync(p)
      }
      const destPath = join(agentDir(name), 'avatar.png')
      writeFileSync(destPath, imgBuffer)
      invalidateThumbsForSource(destPath)
      sendAvatarChangeMessage(name, destPath, AGENTS_BASE_DIR).catch((err) => { logger.warn({ err }, 'Avatar change message failed') })

      logger.info({ name, promptLen: imagePrompt.length, bytes: imgBuffer.length }, 'Avatar generated via Gemini')
      json(res, { ok: true, size: imgBuffer.length, prompt: imagePrompt.slice(0, 200) })
      return true
    } catch (err) {
      logger.error({ err, name }, 'Avatar generation failed')
      json(res, { error: 'Avatar generation failed: ' + (err instanceof Error ? err.message : String(err)) }, 500)
      return true
    }
  }

  // Avatar upload/get
  const avatarUploadMatch = path.match(/^\/api\/agents\/([^/]+)\/avatar$/)
  if (avatarUploadMatch && method === 'POST') {
    const name = sanitizeAgentName(decodeURIComponent(avatarUploadMatch[1]))
    if (!existsSync(agentDir(name))) { json(res, { error: 'Agent not found' }, 404); return true }
    const body = await readBody(req)
    const contentType = req.headers['content-type'] || ''
    for (const ext of ['.png', '.jpg', '.jpeg', '.webp']) {
      const p = join(agentDir(name), `avatar${ext}`)
      if (existsSync(p)) unlinkSync(p)
    }
    if (contentType.includes('application/json')) {
      const { galleryAvatar } = JSON.parse(body.toString()) as { galleryAvatar: string }
      if (!galleryAvatar) { json(res, { error: 'No avatar specified' }, 400); return true }
      if (galleryAvatar.includes('..') || galleryAvatar.includes('/') || galleryAvatar.includes('\\')) {
        json(res, { error: 'Invalid avatar name' }, 400); return true
      }
      const webDir = join(agentDir(name), '..', '..', 'web')
      const srcPath = join(webDir, 'avatars', galleryAvatar)
      if (!existsSync(srcPath)) { json(res, { error: 'Avatar not found' }, 404); return true }
      const ext = extname(galleryAvatar) || '.png'
      const destPath = join(agentDir(name), `avatar${ext}`)
      copyFileSync(srcPath, destPath)
      invalidateThumbsForSource(destPath)
      sendAvatarChangeMessage(name, destPath, AGENTS_BASE_DIR).catch((err) => { logger.warn({ err }, 'Avatar change message failed') })
    } else {
      const { file } = parseMultipart(body, contentType)
      if (!file) { json(res, { error: 'No file uploaded' }, 400); return true }
      const ext = extname(file.name) || '.png'
      const destPath = join(agentDir(name), `avatar${ext}`)
      writeFileSync(destPath, file.data)
      sendAvatarChangeMessage(name, destPath, AGENTS_BASE_DIR).catch((err) => { logger.warn({ err }, 'Avatar change message failed') })
    }
    json(res, { ok: true })
    return true
  }

  if (avatarUploadMatch && method === 'GET') {
    const name = sanitizeAgentName(decodeURIComponent(avatarUploadMatch[1]))
    const avatarPath = findAvatarForAgent(name)
    if (!avatarPath) { res.writeHead(404); res.end(); return true }
    const thumb = parseInt(url.searchParams.get('thumb') || '0', 10)
    if (thumb && thumb >= 32 && thumb <= 512) {
      const thumbPath = await getOrCreateAvatarThumb(avatarPath, thumb)
      serveFile(res, thumbPath, req)
    } else {
      serveFile(res, avatarPath, req)
    }
    return true
  }

  // Telegram routes
  const tgTestMatch = path.match(/^\/api\/agents\/([^/]+)\/telegram\/test$/)
  if (tgTestMatch && method === 'POST') {
    const name = sanitizeAgentName(decodeURIComponent(tgTestMatch[1]))
    if (!existsSync(agentDir(name))) { json(res, { error: 'Agent not found' }, 404); return true }
    const token = parseTelegramToken(name, AGENTS_BASE_DIR)
    if (!token) { json(res, { error: 'Telegram not configured for this agent' }, 404); return true }
    const result = await validateTelegramToken(token)
    if (result.ok) json(res, { ok: true, botUsername: result.botUsername, botId: result.botId })
    else json(res, { error: result.error }, 400)
    return true
  }

  const tgSetupMatch = path.match(/^\/api\/agents\/([^/]+)\/telegram$/)
  if (tgSetupMatch && method === 'POST') {
    const name = sanitizeAgentName(decodeURIComponent(tgSetupMatch[1]))
    if (!existsSync(agentDir(name))) { json(res, { error: 'Agent not found' }, 404); return true }
    const body = await readBody(req)
    const { botToken } = JSON.parse(body.toString()) as { botToken: string }
    if (!botToken?.trim()) { json(res, { error: 'botToken is required' }, 400); return true }
    // Security #7: .env token-injection védelem. A Telegram token formátuma
    // szigorú: `\d+:[A-Za-z0-9_-]+`. Bármi egyéb (pl. \n, \r, ", $, backtick)
    // potenciálisan új env-sort csempészne be. Regex-ellenőrzés a write előtt.
    const trimmedToken = botToken.trim()
    if (!/^\d+:[A-Za-z0-9_-]+$/.test(trimmedToken)) {
      json(res, { error: 'Invalid bot token format' }, 400); return true
    }
    const validation = await validateTelegramToken(trimmedToken)
    if (!validation.ok) { json(res, { error: validation.error || 'Invalid bot token' }, 400); return true }
    const tgDir = join(agentDir(name), '.claude', 'channels', 'telegram')
    mkdirSync(tgDir, { recursive: true })
    writeFileSync(join(tgDir, '.env'), `TELEGRAM_BOT_TOKEN=${trimmedToken}\n`, { mode: 0o600 })
    writeFileSync(join(tgDir, 'access.json'), JSON.stringify({
      dmPolicy: 'allowlist',
      allowFrom: [ALLOWED_CHAT_ID],
      groups: {},
      pending: {},
    }, null, 2))
    sendWelcomeMessage(name, botToken.trim(), AGENTS_BASE_DIR, findAvatarForAgent).catch((err) => { logger.warn({ err }, 'Welcome message send failed') })
    json(res, { ok: true, botUsername: validation.botUsername, botId: validation.botId })
    return true
  }

  if (tgSetupMatch && method === 'DELETE') {
    const name = sanitizeAgentName(decodeURIComponent(tgSetupMatch[1]))
    if (!existsSync(agentDir(name))) { json(res, { error: 'Agent not found' }, 404); return true }
    const tgDir = join(agentDir(name), '.claude', 'channels', 'telegram')
    const envFile = join(tgDir, '.env')
    const accessFile = join(tgDir, 'access.json')
    if (existsSync(envFile)) unlinkSync(envFile)
    if (existsSync(accessFile)) unlinkSync(accessFile)
    json(res, { ok: true })
    return true
  }

  const tgPendingMatch = path.match(/^\/api\/agents\/([^/]+)\/telegram\/pending$/)
  if (tgPendingMatch && method === 'GET') {
    const name = sanitizeAgentName(decodeURIComponent(tgPendingMatch[1]))
    if (!existsSync(agentDir(name))) { json(res, { error: 'Agent not found' }, 404); return true }
    const accessPath = join(agentDir(name), '.claude', 'channels', 'telegram', 'access.json')
    const accessContent = readFileOr(accessPath, '{}')
    try {
      const access = JSON.parse(accessContent)
      const pending = access.pending || {}
      const entries = Object.entries(pending).map(([code, entry]: [string, any]) => ({
        code, senderId: entry.senderId, chatId: entry.chatId, createdAt: entry.createdAt, expiresAt: entry.expiresAt,
      }))
      json(res, entries)
    } catch {
      json(res, [])
    }
    return true
  }

  const tgApproveMatch = path.match(/^\/api\/agents\/([^/]+)\/telegram\/approve$/)
  if (tgApproveMatch && method === 'POST') {
    const name = sanitizeAgentName(decodeURIComponent(tgApproveMatch[1]))
    if (!existsSync(agentDir(name))) { json(res, { error: 'Agent not found' }, 404); return true }
    const body = await readBody(req)
    const { code } = JSON.parse(body.toString()) as { code: string }
    if (!code?.trim()) { json(res, { error: 'Code is required' }, 400); return true }
    const tgDir = join(agentDir(name), '.claude', 'channels', 'telegram')
    const accessPath = join(tgDir, 'access.json')
    const accessContent = readFileOr(accessPath, '{}')
    try {
      const access = JSON.parse(accessContent)
      const pending = access.pending || {}
      const entry = pending[code.trim()]
      if (!entry) { json(res, { error: 'Invalid or expired code' }, 404); return true }
      if (!access.allowFrom) access.allowFrom = []
      if (!access.allowFrom.includes(entry.senderId)) access.allowFrom.push(entry.senderId)
      delete access.pending[code.trim()]
      writeFileSync(accessPath, JSON.stringify(access, null, 2))
      const approvedDir = join(tgDir, 'approved')
      mkdirSync(approvedDir, { recursive: true })
      writeFileSync(join(approvedDir, entry.senderId), '')
      logger.info({ name, senderId: entry.senderId, code }, 'Telegram pairing approved')
      json(res, { ok: true, senderId: entry.senderId })
    } catch (err) {
      logger.error({ err }, 'Failed to approve pairing')
      json(res, { error: 'Failed to approve pairing' }, 500)
    }
    return true
  }

  // Agent process control
  const startMatch = path.match(/^\/api\/agents\/([^/]+)\/start$/)
  if (startMatch && method === 'POST') {
    const name = sanitizeAgentName(decodeURIComponent(startMatch[1]))
    if (!existsSync(agentDir(name))) { json(res, { error: 'Agent not found' }, 404); return true }
    const result = await startAgentProcess(name)
    if (result.ok) json(res, { ok: true })
    else json(res, { error: result.error }, 400)
    return true
  }

  const stopMatch = path.match(/^\/api\/agents\/([^/]+)\/stop$/)
  if (stopMatch && method === 'POST') {
    const name = sanitizeAgentName(decodeURIComponent(stopMatch[1]))
    const result = await stopAgentProcess(name)
    if (result.ok) json(res, { ok: true })
    else json(res, { error: result.error }, 400)
    return true
  }

  const statusMatch = path.match(/^\/api\/agents\/([^/]+)\/status$/)
  if (statusMatch && method === 'GET') {
    const name = sanitizeAgentName(decodeURIComponent(statusMatch[1]))
    if (!existsSync(agentDir(name))) { json(res, { error: 'Agent not found' }, 404); return true }
    json(res, getAgentProcessInfo(name))
    return true
  }


  // Skills copy — általános irányított (source_agent → target_agent)
  // POST /api/skills/copy { source_agent, target_agent, skill_name }
  if (path === '/api/skills/copy' && method === 'POST') {
    const body = await readBody(req)
    const { source_agent: rawSource, target_agent: rawTarget, skill_name: rawSkill } =
      JSON.parse(body.toString()) as { source_agent: string; target_agent: string; skill_name: string }

    const sourceAgent = sanitizeAgentName(rawSource || '')
    const targetAgent = sanitizeAgentName(rawTarget || '')
    const skillName = sanitizeSkillName(rawSkill || '')

    if (!sourceAgent || !targetAgent || !skillName) {
      json(res, { error: 'source_agent, target_agent, skill_name mind kötelező' }, 400)
      return true
    }
    if (sourceAgent === targetAgent) {
      json(res, { error: 'Ugyanaz az agent source és target' }, 400)
      return true
    }

    // Forrás és cél skill-könyvtár meghatározása
    // 'nova' = fő agent → PROJECT_ROOT/.claude/skills
    // bármely más = agents/<name>/.claude/skills
    const skillsDirFor = (name: string): string =>
      name === 'nova'
        ? join(PROJECT_ROOT, '.claude', 'skills')
        : join(agentDir(name), '.claude', 'skills')

    const srcSkillsDir = skillsDirFor(sourceAgent)
    const destSkillsDir = skillsDirFor(targetAgent)

    if (!existsSync(srcSkillsDir)) {
      json(res, { error: 'Source agent skills könyvtár nem létezik: ' + sourceAgent }, 404)
      return true
    }
    if (targetAgent !== 'nova' && !existsSync(agentDir(targetAgent))) {
      json(res, { error: 'Target agent nem létezik: ' + targetAgent }, 404)
      return true
    }
    mkdirSync(destSkillsDir, { recursive: true })

    const srcDir = join(srcSkillsDir, skillName)
    const srcFile = join(srcSkillsDir, skillName + '.md')
    const destDir = join(destSkillsDir, skillName)
    const destFile = join(destSkillsDir, skillName + '.md')

    if (existsSync(destDir) || existsSync(destFile)) {
      json(res, { error: 'Cél agentnél már létezik ez a skill: ' + skillName }, 409)
      return true
    }

    try {
      if (existsSync(srcDir) && statSync(srcDir).isDirectory()) {
        execSync(`cp -r "${srcDir}" "${destDir}"`, { timeout: 10000 })
      } else if (existsSync(srcFile)) {
        copyFileSync(srcFile, destFile)
      } else {
        json(res, { error: 'Forrás skill nem található: ' + skillName }, 404)
        return true
      }
      logger.info({ sourceAgent, targetAgent, skillName }, 'Skill másolva (irányított)')
      json(res, { ok: true, source_agent: sourceAgent, target_agent: targetAgent, skill_name: skillName })
    } catch (err) {
      logger.error({ err, sourceAgent, targetAgent, skillName }, 'Skill copy failed')
      json(res, { error: 'Másolás sikertelen' }, 500)
    }
    return true
  }

  // Skills copy from Nova
  const skillCopyMatch = path.match(/^\/api\/agents\/([^/]+)\/skills\/copy$/)
  if (skillCopyMatch && method === 'POST') {
    const name = sanitizeAgentName(decodeURIComponent(skillCopyMatch[1]))
    if (!name) { json(res, { error: 'Invalid agent name' }, 400); return true }
    if (!existsSync(agentDir(name))) { json(res, { error: 'Agent not found' }, 404); return true }
    const body = await readBody(req)
    const { skills: skillNames } = JSON.parse(body.toString()) as { skills: string[] }
    if (!Array.isArray(skillNames) || skillNames.length === 0) { json(res, { error: 'No skills specified' }, 400); return true }
    const novaSkillsDir = join(PROJECT_ROOT, '.claude', 'skills')
    const agentSkillsDir = join(agentDir(name), '.claude', 'skills')
    mkdirSync(agentSkillsDir, { recursive: true })
    const copied: string[] = []
    const errors: string[] = []
    for (const raw of skillNames) {
      const skillName = sanitizeSkillName(raw)
      if (!skillName) { errors.push('Invalid: ' + raw); continue }
      const srcDir = join(novaSkillsDir, skillName)
      const srcFile = join(novaSkillsDir, skillName + '.md')
      const destDir = join(agentSkillsDir, skillName)
      const destFile = join(agentSkillsDir, skillName + '.md')
      if (existsSync(destDir) || existsSync(destFile)) { errors.push('Already exists: ' + skillName); continue }
      try {
        if (existsSync(srcDir) && statSync(srcDir).isDirectory()) {
          execSync(`cp -r "${srcDir}" "${destDir}"`, { timeout: 10000 })
          copied.push(skillName)
        } else if (existsSync(srcFile)) {
          copyFileSync(srcFile, destFile)
          copied.push(skillName)
        } else {
          errors.push('Not found: ' + skillName)
        }
      } catch { errors.push('Copy failed: ' + skillName) }
    }
    logger.info({ name, copied, errors }, 'Skills copied from Nova')
    json(res, { ok: true, copied, errors })
    return true
  }

  // Skills import
  const skillImportMatch = path.match(/^\/api\/agents\/([^/]+)\/skills\/import$/)
  if (skillImportMatch && method === 'POST') {
    const name = sanitizeAgentName(decodeURIComponent(skillImportMatch[1]))
    if (!name) { json(res, { error: 'Invalid agent name' }, 400); return true }
    if (!existsSync(agentDir(name))) { json(res, { error: 'Agent not found' }, 404); return true }
    const body = await readBody(req)
    const contentType = req.headers['content-type'] || ''
    const { file } = parseMultipart(body, contentType)
    if (!file) { json(res, { error: 'No file uploaded' }, 400); return true }
    const skillsDir = join(agentDir(name), '.claude', 'skills')
    mkdirSync(skillsDir, { recursive: true })
    const tmpPath = join(skillsDir, `_import_${randomUUID()}.zip`)
    try {
      writeFileSync(tmpPath, file.data)
      const listOutput = execSync(`unzip -Z1 "${tmpPath}" 2>&1`, { timeout: 5000, encoding: 'utf-8' })
      const entries = listOutput.split('\n').map((l) => l.trim()).filter(Boolean)
      const before = new Set(readdirSync(skillsDir))
      for (const entry of entries) {
        if (entry.includes('..') || entry.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(entry)) {
          unlinkSync(tmpPath)
          json(res, { error: 'Invalid skill file: path traversal detected' }, 400)
          return true
        }
      }
      execSync(`unzip -o "${tmpPath}" -d "${skillsDir}"`, { timeout: 10000 })
      unlinkSync(tmpPath)
      const after = readdirSync(skillsDir).filter((f) => !before.has(f))
      const rejectSymlinks = (dir: string): boolean => {
        for (const entry of readdirSync(dir)) {
          const p = join(dir, entry)
          const st = lstatSync(p)
          if (st.isSymbolicLink()) return true
          if (st.isDirectory() && rejectSymlinks(p)) return true
        }
        return false
      }
      for (const f of after) {
        const p = join(skillsDir, f)
        try {
          if (lstatSync(p).isSymbolicLink() || (statSync(p).isDirectory() && rejectSymlinks(p))) {
            rmSync(p, { recursive: true, force: true })
            json(res, { error: 'Invalid skill file: symlink entries rejected' }, 400)
            return true
          }
        } catch { /* ignored */ }
      }
      const extracted = readdirSync(skillsDir).filter(f => {
        const p = join(skillsDir, f)
        try { return statSync(p).isDirectory() && existsSync(join(p, 'SKILL.md')) } catch { return false }
      })
      logger.info({ name, skills: extracted }, 'Skill(s) imported')
      json(res, { ok: true, imported: extracted })
    } catch (err) {
      try { unlinkSync(tmpPath) } catch { /* ignored */ }
      logger.error({ err }, 'Failed to import skill')
      json(res, { error: 'Failed to extract .skill file' }, 500)
    }
    return true
  }

  // Skills CRUD (individual skill GET/PUT/DELETE)
  const skillActionMatch = path.match(/^\/api\/agents\/([^/]+)\/skills\/([^/]+)$/)
  if (skillActionMatch && method === 'GET') {
    const name = sanitizeAgentName(decodeURIComponent(skillActionMatch[1]))
    const skillName = sanitizeSkillName(decodeURIComponent(skillActionMatch[2]))
    if (!name || !skillName) { json(res, { error: 'Invalid agent or skill name' }, 400); return true }
    if (!existsSync(agentDir(name))) { json(res, { error: 'Agent not found' }, 404); return true }
    let skillDir: string
    try { skillDir = safeJoin(agentDir(name), '.claude', 'skills', skillName) } catch { json(res, { error: 'Invalid skill path' }, 400); return true }
    const skillPath = join(skillDir, 'SKILL.md')
    if (!existsSync(skillPath)) { json(res, { error: 'Skill not found' }, 404); return true }
    const content = readFileOr(skillPath, '')
    json(res, { name: skillName, content })
    return true
  }
  if (skillActionMatch && method === 'PUT') {
    const name = sanitizeAgentName(decodeURIComponent(skillActionMatch[1]))
    const skillName = sanitizeSkillName(decodeURIComponent(skillActionMatch[2]))
    if (!name || !skillName) { json(res, { error: 'Invalid agent or skill name' }, 400); return true }
    if (!existsSync(agentDir(name))) { json(res, { error: 'Agent not found' }, 404); return true }
    let skillDir: string
    try { skillDir = safeJoin(agentDir(name), '.claude', 'skills', skillName) } catch { json(res, { error: 'Invalid skill path' }, 400); return true }
    mkdirSync(skillDir, { recursive: true })
    const body = await readBody(req)
    const { content } = JSON.parse(body.toString()) as { content: string }
    writeFileSync(join(skillDir, 'SKILL.md'), content)
    json(res, { ok: true })
    return true
  }
  if (skillActionMatch && method === 'DELETE') {
    const name = sanitizeAgentName(decodeURIComponent(skillActionMatch[1]))
    const skillName = sanitizeSkillName(decodeURIComponent(skillActionMatch[2]))
    if (!name || !skillName) { json(res, { error: 'Invalid agent or skill name' }, 400); return true }
    if (!existsSync(agentDir(name))) { json(res, { error: 'Agent not found' }, 404); return true }
    let skillDir: string
    try { skillDir = safeJoin(agentDir(name), '.claude', 'skills', skillName) } catch { json(res, { error: 'Invalid skill path' }, 400); return true }
    if (!existsSync(skillDir)) { json(res, { error: 'Skill not found' }, 404); return true }
    rmSync(skillDir, { recursive: true, force: true })
    json(res, { ok: true })
    return true
  }

  const skillsMatch = path.match(/^\/api\/agents\/([^/]+)\/skills$/)
  if (skillsMatch && method === 'GET') {
    const name = sanitizeAgentName(decodeURIComponent(skillsMatch[1]))
    if (!existsSync(agentDir(name))) { json(res, { error: 'Agent not found' }, 404); return true }
    const skillsDir = join(agentDir(name), '.claude', 'skills')
    let skills: { name: string; hasSkillMd: boolean; description: string }[] = []
    if (existsSync(skillsDir)) {
      skills = readdirSync(skillsDir)
        .filter((f) => { try { return statSync(join(skillsDir, f)).isDirectory() } catch { return false } })
        .map((f) => {
          const content = readFileOr(join(skillsDir, f, 'SKILL.md'), '')
          const description = content
            ? (content.match(/description:\s*(.+)/i)?.[1]?.trim() || content.match(/^#\s*(?:Skill:\s*)?(.+)/m)?.[1]?.trim() || f).slice(0, 120)
            : f
          return { name: f, hasSkillMd: existsSync(join(skillsDir, f, 'SKILL.md')), description }
        })
    }
    json(res, skills)
    return true
  }

  if (skillsMatch && method === 'POST') {
    const agentName = sanitizeAgentName(decodeURIComponent(skillsMatch[1]))
    if (!existsSync(agentDir(agentName))) { json(res, { error: 'Agent not found' }, 404); return true }
    const body = await readBody(req)
    const { name: rawSkillName, description } = JSON.parse(body.toString()) as { name: string; description: string }
    const skillName = sanitizeAgentName(rawSkillName || '')
    if (!skillName) { json(res, { error: 'Skill name is required' }, 400); return true }
    if (!description) { json(res, { error: 'Skill description is required' }, 400); return true }
    const skillDir = join(agentDir(agentName), '.claude', 'skills', skillName)
    if (existsSync(skillDir)) { json(res, { error: 'Skill already exists' }, 409); return true }
    mkdirSync(skillDir, { recursive: true })
    try {
      const skillMd = await generateSkillMd(skillName, description)
      writeFileSync(join(skillDir, 'SKILL.md'), skillMd)
    } catch (err) {
      rmSync(skillDir, { recursive: true, force: true })
      json(res, { error: 'Failed to generate skill' }, 500)
      return true
    }
    json(res, { ok: true, name: skillName })
    return true
  }

  // Agent CRUD (single)
  const agentMatch = path.match(/^\/api\/agents\/([^/]+)$/)
  if (agentMatch && method === 'GET') {
    const name = sanitizeAgentName(decodeURIComponent(agentMatch[1]))
    if (!existsSync(agentDir(name))) { json(res, { error: 'Agent not found' }, 404); return true }
    json(res, getAgentDetail(name))
    return true
  }

  if (agentMatch && method === 'PUT') {
    const name = sanitizeAgentName(decodeURIComponent(agentMatch[1]))
    if (!existsSync(agentDir(name))) { json(res, { error: 'Agent not found' }, 404); return true }
    const body = await readBody(req)
    const data = JSON.parse(body.toString()) as { claudeMd?: string; soulMd?: string; mcpJson?: string; model?: string }
    if (data.claudeMd !== undefined) writeFileSync(join(agentDir(name), 'CLAUDE.md'), data.claudeMd)
    if (data.soulMd !== undefined) writeFileSync(join(agentDir(name), 'SOUL.md'), data.soulMd)
    if (data.mcpJson !== undefined) writeFileSync(join(agentDir(name), '.mcp.json'), data.mcpJson)
    if (data.model !== undefined) writeAgentModel(name, data.model)
    json(res, { ok: true })
    return true
  }

  if (agentMatch && method === 'DELETE') {
    const name = sanitizeAgentName(decodeURIComponent(agentMatch[1]))
    const dir = agentDir(name)
    if (!existsSync(dir)) { json(res, { error: 'Agent not found' }, 404); return true }
    rmSync(dir, { recursive: true, force: true })
    json(res, { ok: true })
    return true
  }

  return false
}
