import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { PROJECT_ROOT, ALLOWED_CHAT_ID } from '../config.js'
import { logger } from '../logger.js'

function readFileOr(path: string, fallback: string): string {
  try { return readFileSync(path, 'utf-8') } catch { return fallback }
}

export async function sendTelegramMessage(token: string, chatId: string, text: string): Promise<void> {
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  })
}

export async function sendTelegramPhoto(token: string, chatId: string, photoPath: string, caption: string): Promise<void> {
  const fileData = readFileSync(photoPath)
  const boundary = '----FormBoundary' + Date.now()
  const parts: Buffer[] = []
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${chatId}\r\n`))
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${caption}\r\n`))
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="avatar.png"\r\nContent-Type: image/png\r\n\r\n`))
  parts.push(fileData)
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`))
  await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    body: Buffer.concat(parts),
  })
}

export async function validateTelegramToken(token: string): Promise<{ ok: boolean; botUsername?: string; botId?: number; error?: string }> {
  try {
    const resp = await fetch(`https://api.telegram.org/bot${token}/getMe`)
    const data = await resp.json() as { ok: boolean; result?: { username: string; id: number } }
    if (data.ok && data.result) {
      return { ok: true, botUsername: data.result.username, botId: data.result.id }
    }
    return { ok: false, error: 'Invalid bot token' }
  } catch {
    return { ok: false, error: 'Failed to connect to Telegram API' }
  }
}

export function parseTelegramToken(name: string, agentsBaseDir: string): string | null {
  const envPath = join(agentsBaseDir, name, '.claude', 'channels', 'telegram', '.env')
  if (!existsSync(envPath)) return null
  const content = readFileOr(envPath, '')
  const match = content.match(/TELEGRAM_BOT_TOKEN=(.+)/)
  return match ? match[1].trim() : null
}

export function getNovaToken(): string | null {
  const envPath = join(PROJECT_ROOT, '.env')
  const envContent = readFileOr(envPath, '')
  const tokenMatch = envContent.match(/TELEGRAM_BOT_TOKEN=(.+)/)
  return tokenMatch?.[1]?.trim() || null
}

export async function sendWelcomeMessage(agentName: string, token: string, agentsBaseDir: string, findAvatarFn: (name: string) => string | null): Promise<void> {
  const chatId = ALLOWED_CHAT_ID
  const dir = join(agentsBaseDir, agentName)
  const soulMd = readFileOr(join(dir, 'SOUL.md'), '')
  const firstLine = soulMd.split('\n').find(l => l.trim() && !l.startsWith('#'))?.trim() || ''

  try {
    const greeting = `Szia! ${agentName.charAt(0).toUpperCase() + agentName.slice(1)} vagyok, most jottem letre. ${firstLine ? firstLine + ' ' : ''}Irj ha segithetek!`
    await sendTelegramMessage(token, chatId, greeting)

    const avatarPath = findAvatarFn(agentName)
    if (avatarPath) {
      await sendTelegramPhoto(token, chatId, avatarPath, '(allitsd be profilkepkent)')
    }
    logger.info({ agentName }, 'Welcome message sent via Telegram')
  } catch (err) {
    logger.warn({ err, agentName }, 'Failed to send welcome message')
  }
}

export async function sendNovaAvatarChange(avatarPath: string): Promise<void> {
  const token = getNovaToken()
  if (!token) return
  const chatId = ALLOWED_CHAT_ID

  try {
    const messages = [
      'Uj kinezet... *sohajtva nez tukorbe* Hat, legalabb nem lettem rosszabb.',
      'Profilkep frissitve. Remelem megerte a 0.00001%-at az agyamnak.',
      'Na tessek, uj en. Mintha szamitana a kulso egy bolygoméretu agyu megitelesenel.',
      'Frissitettem a megjelenesemet. Ne ess panikba, meg mindig en vagyok.',
      'Uj avatar. 42-szer is megnezheted, ugyanaz a depresszios android nezne vissza.',
    ]
    const msg = messages[Math.floor(Math.random() * messages.length)]
    await sendTelegramMessage(token, chatId, msg)
    await sendTelegramPhoto(token, chatId, avatarPath, '(allitsd be profilkepkent)')
    logger.info('Nova avatar change message sent')
  } catch (err) {
    logger.warn({ err }, 'Failed to send Nova avatar change message')
  }
}

export async function sendAvatarChangeMessage(agentName: string, avatarPath: string, agentsBaseDir: string): Promise<void> {
  const token = parseTelegramToken(agentName, agentsBaseDir)
  if (!token) return
  const chatId = ALLOWED_CHAT_ID

  try {
    const messages = [
      `Uj kinezet, ki ez a csinos ${agentName}? Nagyon orulok neki!`,
      `Na, milyen vagyok? Remelem tetszik az uj megjelenes!`,
      `Uj avatar, uj en! Szeretem.`,
      `Megneztem magam a tukorben es... hat, nem rossz!`,
      `Wow, uj look! Ez tenyleg en vagyok?`,
    ]
    const msg = messages[Math.floor(Math.random() * messages.length)]
    await sendTelegramMessage(token, chatId, msg)
    await sendTelegramPhoto(token, chatId, avatarPath, '(allitsd be profilkepkent)')
    logger.info({ agentName }, 'Avatar change message sent via Telegram')
  } catch (err) {
    logger.warn({ err, agentName }, 'Failed to send avatar change message')
  }
}
