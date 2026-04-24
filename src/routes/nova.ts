import { existsSync, writeFileSync, readdirSync, unlinkSync, statSync, copyFileSync, mkdirSync } from 'node:fs'
import { join, extname } from 'node:path'
import { PROJECT_ROOT } from '../config.js'
import { readBody, json, serveFile } from '../utils/http.js'
import { sanitizeSkillName, safeJoin } from "../utils/sanitize.js"
import { parseMultipart } from '../utils/multipart.js'
import { readFileOr, generateSkillMd } from '../services/agent-manager.js'
import { sendNovaAvatarChange } from '../services/telegram.js'
import { logger } from '../logger.js'
import { getOrCreateAvatarThumb, invalidateThumbsForSource } from '../utils/thumbnail.js'
import type { RouteContext } from './types.js'

const WEB_DIR = join(PROJECT_ROOT, 'web')

export async function novaRoutes(ctx: RouteContext): Promise<boolean> {
  const { path, method, req, res, url } = ctx

  if (path === '/api/nova' && method === 'GET') {
    const claudeMd = readFileOr(join(PROJECT_ROOT, 'CLAUDE.md'), '')
    const soulMd = readFileOr(join(PROJECT_ROOT, 'SOUL.md'), '')
    const mcpJson = readFileOr(join(PROJECT_ROOT, '.mcp.json'), '{}')
    const skillsDir = join(PROJECT_ROOT, '.claude', 'skills')
    let skills: { name: string; description: string }[] = []
    try {
      const entries = readdirSync(skillsDir)
      for (const entry of entries) {
        const entryPath = join(skillsDir, entry)
        let content = ''
        if (statSync(entryPath).isDirectory()) content = readFileOr(join(entryPath, 'SKILL.md'), '')
        else if (entry.endsWith('.md')) content = readFileOr(entryPath, '')
        if (content) {
          const descMatch = content.match(/description:\s*(.+)/i)?.[1]?.trim() || content.match(/^#\s*(?:Skill:\s*)?(.+)/m)?.[1]?.trim() || entry.replace(/\.md$/, '')
          skills.push({ name: entry.replace(/\.md$/, ''), description: descMatch.slice(0, 120) })
        }
      }
    } catch {}
    let avatarVersion = 0
    for (const ext of ['.png', '.jpg', '.jpeg', '.webp']) {
      const ap = join(PROJECT_ROOT, 'store', `nova-avatar${ext}`)
      if (existsSync(ap)) { try { avatarVersion = Math.floor(statSync(ap).mtimeMs / 1000) } catch {} ; break }
    }
    json(res, { name: 'Nova', description: 'Owner (Owner) személyes AI asszisztense. Barátságos, precíz, tömör.', model: 'claude-opus-4-6', running: true, hasTelegram: true, role: 'main', claudeMd, soulMd, mcpJson, skills, avatarVersion })
    return true
  }

  if (path === '/api/nova' && method === 'PUT') {
    const body = await readBody(req)
    const data = JSON.parse(body.toString()) as { description?: string; claudeMd?: string; soulMd?: string; mcpJson?: string }
    if (data.claudeMd !== undefined) writeFileSync(join(PROJECT_ROOT, 'CLAUDE.md'), data.claudeMd)
    if (data.soulMd !== undefined) writeFileSync(join(PROJECT_ROOT, 'SOUL.md'), data.soulMd)
    if (data.mcpJson !== undefined) writeFileSync(join(PROJECT_ROOT, '.mcp.json'), data.mcpJson)
    json(res, { ok: true })
    return true
  }

  const novaSkillMatch = path.match(/^\/api\/nova\/skills\/([^/]+)$/)
  if (novaSkillMatch && method === 'GET') {
    const skillName = sanitizeSkillName(decodeURIComponent(novaSkillMatch[1]))
    const skillsDir = join(PROJECT_ROOT, '.claude', 'skills')
    const dirPath = join(skillsDir, skillName)
    const filePath = join(skillsDir, skillName + '.md')
    let content = ''
    try {
      if (existsSync(dirPath) && statSync(dirPath).isDirectory()) content = readFileOr(join(dirPath, 'SKILL.md'), '')
      else if (existsSync(filePath)) content = readFileOr(filePath, '')
    } catch {}
    if (!content) { json(res, { error: 'Skill not found' }, 404); return true }
    json(res, { name: skillName, content })
    return true
  }
  if (novaSkillMatch && method === 'PUT') {
    const skillName = sanitizeSkillName(decodeURIComponent(novaSkillMatch[1]))
    const body = await readBody(req)
    const data = JSON.parse(body.toString()) as { content: string }
    const skillsDir = join(PROJECT_ROOT, '.claude', 'skills')
    const dirPath = join(skillsDir, skillName)
    const filePath = join(skillsDir, skillName + '.md')
    if (existsSync(dirPath) && statSync(dirPath).isDirectory()) writeFileSync(join(dirPath, 'SKILL.md'), data.content)
    else writeFileSync(filePath, data.content)
    json(res, { ok: true })
    return true
  }

  // Nova skill create
  if (path === '/api/nova/skills' && method === 'POST') {
    const body = await readBody(req)
    const { name: rawName, description } = JSON.parse(body.toString()) as { name: string; description: string }
    const skillName = (rawName || '').toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
    if (!skillName) { json(res, { error: 'Skill név kötelező' }, 400); return true }
    if (!description) { json(res, { error: 'Leírás kötelező' }, 400); return true }
    const skillsDir = join(PROJECT_ROOT, '.claude', 'skills')
    const skillDir = join(skillsDir, skillName)
    if (existsSync(skillDir)) { json(res, { error: 'Skill már létezik' }, 409); return true }
    mkdirSync(skillDir, { recursive: true })
    try {
      const skillMd = await generateSkillMd(skillName, description)
      writeFileSync(join(skillDir, 'SKILL.md'), skillMd)
      logger.info({ skillName }, 'Nova skill created')
      json(res, { ok: true, name: skillName })
    } catch (err) {
      const { rmSync } = await import('node:fs')
      rmSync(skillDir, { recursive: true, force: true })
      logger.error({ err }, 'Failed to generate skill')
      json(res, { error: 'Skill generálás sikertelen' }, 500)
    }
    return true
  }

  // Nova avatar
  if (path === '/api/nova/avatar' && method === 'GET') {
    let avatarPath = ''
    for (const ext of ['.png', '.jpg', '.jpeg', '.webp']) {
      const p = join(PROJECT_ROOT, 'store', `nova-avatar${ext}`)
      if (existsSync(p)) { avatarPath = p; break }
    }
    if (!avatarPath) {
      const fallback = join(WEB_DIR, 'avatars', '01_robot.png')
      if (existsSync(fallback)) avatarPath = fallback
    }
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

  if (path === '/api/nova/avatar' && method === 'POST') {
    const body = await readBody(req)
    const contentType = req.headers['content-type'] || ''
    for (const ext of ['.png', '.jpg', '.jpeg', '.webp']) {
      const p = join(PROJECT_ROOT, 'store', `nova-avatar${ext}`)
      if (existsSync(p)) unlinkSync(p)
    }
    if (contentType.includes('application/json')) {
      const { galleryAvatar } = JSON.parse(body.toString()) as { galleryAvatar: string }
      if (!galleryAvatar) { json(res, { error: 'No avatar specified' }, 400); return true }
      if (galleryAvatar.includes('..') || galleryAvatar.includes('/') || galleryAvatar.includes('\\')) { json(res, { error: 'Invalid avatar name' }, 400); return true }
      const srcPath = join(WEB_DIR, 'avatars', galleryAvatar)
      if (!existsSync(srcPath)) { json(res, { error: 'Avatar not found' }, 404); return true }
      const destPath = join(PROJECT_ROOT, 'store', `nova-avatar${extname(galleryAvatar) || '.png'}`)
      copyFileSync(srcPath, destPath); invalidateThumbsForSource(destPath)
      sendNovaAvatarChange(destPath).catch((err) => { logger.warn({ err }, 'Nova avatar change message failed') })
    } else {
      const { file } = parseMultipart(body, contentType)
      if (!file) { json(res, { error: 'No file uploaded' }, 400); return true }
      const destPath = join(PROJECT_ROOT, 'store', `nova-avatar${extname(file.name) || '.png'}`)
      writeFileSync(destPath, file.data)
      sendNovaAvatarChange(destPath).catch((err) => { logger.warn({ err }, 'Nova avatar change message failed') })
    }
    json(res, { ok: true })
    return true
  }

  return false
}
