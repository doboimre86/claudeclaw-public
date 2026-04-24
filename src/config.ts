import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readEnvFile } from './env.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

export const PROJECT_ROOT = join(__dirname, '..')
export const STORE_DIR = join(PROJECT_ROOT, 'store')

const env = readEnvFile()

export const TELEGRAM_BOT_TOKEN = env['TELEGRAM_BOT_TOKEN'] ?? ''
export const ALLOWED_CHAT_ID = env['ALLOWED_CHAT_ID'] ?? ''

export const OWNER_NAME = env['OWNER_NAME'] ?? 'Owner'

export const WEB_PORT = parseInt(env['WEB_PORT'] ?? '3420', 10)

// Webhook shared-secret — ha üres, a /api/webhook open. Ha be van állítva,
// a kliensnek kötelező `X-Webhook-Secret` header-ben küldeni.
export const WEBHOOK_SECRET = env['WEBHOOK_SECRET'] ?? ''

// Heartbeat
export const HEARTBEAT_INTERVAL_MS = 60 * 60 * 1000 // 1 hour
export const HEARTBEAT_START_HOUR = 9
export const HEARTBEAT_END_HOUR = 23
export const HEARTBEAT_CALENDAR_ID = env['HEARTBEAT_CALENDAR_ID'] ?? ''

export const OLLAMA_URL = env['OLLAMA_URL'] ?? 'http://localhost:11434'
