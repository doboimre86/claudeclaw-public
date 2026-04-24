import { execSync, execFileSync } from 'node:child_process'

// Default TMUX binary with Nova's socket — kept for legacy callers (scheduler, etc.)
// that expect ${TMUX} to resolve to Nova's tmux server. New code should prefer
// sendToAgentSession() which derives the correct socket per-agent.
export const TMUX = '/usr/bin/tmux -S /tmp/tmux-997/default'
const TMUX_BIN = '/usr/bin/tmux'
export const CLAUDE = '/usr/bin/claude'

// --- Agent uid / socket resolution ---
// Each agent runs as a Linux user with the same name (systemd User=<name>).
// The per-user tmux default socket is /tmp/tmux-<uid>/default.
// This lets new agents work without code changes.

const agentUidCache: Map<string, { uid: number | null; ts: number }> = new Map()
export function getAgentUid(name: string): number | null {
  if (!/^[a-z0-9-]+$/.test(name)) return null
  const now = Date.now()
  const cached = agentUidCache.get(name)
  if (cached && now - cached.ts < 300_000) return cached.uid
  let uid: number | null = null
  try {
    const out = execSync(`id -u ${name}`, { encoding: 'utf-8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    if (/^\d+$/.test(out)) uid = parseInt(out, 10)
  } catch { /* user does not exist */ }
  agentUidCache.set(name, { uid, ts: now })
  return uid
}

export function agentTmuxSocket(name: string): string | null {
  const uid = getAgentUid(name)
  return uid !== null ? `/tmp/tmux-${uid}/default` : null
}

export function agentSessionName(name: string): string {
  if (name === 'nova') return 'nova-channels'
  return `agent-${name}`
}

let tmuxSessionCache: { sessions: string; ts: number } | null = null
export function getTmuxSessions(): string {
  const now = Date.now()
  if (tmuxSessionCache && now - tmuxSessionCache.ts < 5000) return tmuxSessionCache.sessions
  const sockets = new Set<string>(['/tmp/tmux-0/default'])
  const novaSock = agentTmuxSocket('nova')
  if (novaSock) sockets.add(novaSock)
  let all = ''
  for (const sock of sockets) {
    try {
      all += execSync(`${TMUX_BIN} -S ${sock} list-sessions -F "#{session_name}" 2>/dev/null`, { timeout: 3000, encoding: 'utf-8' })
    } catch { /* socket may not exist */ }
  }
  try {
    all += execSync(`${TMUX_BIN} list-sessions -F "#{session_name}" 2>/dev/null`, { timeout: 3000, encoding: 'utf-8' })
  } catch { /* ok */ }
  tmuxSessionCache = { sessions: all, ts: now }
  return all
}

export function isAgentRunning(name: string): boolean {
  const session = agentSessionName(name)
  const sock = agentTmuxSocket(name)
  if (sock) {
    try {
      const result = execSync(`${TMUX_BIN} -S ${sock} list-sessions -F "#{session_name}" 2>/dev/null`, { timeout: 2000, encoding: 'utf-8' })
      if (result.split('\n').some(s => s.trim() === session)) return true
    } catch { /* ok */ }
  }
  return getTmuxSessions().split('\n').some(line => line.trim() === session)
}

export function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'"
}

/**
 * Reliable send-keys to Claude Code TUI: clears stuck input, sends literal text,
 * waits for render, submits with C-m. Uses the correct per-agent tmux socket.
 * Returns true on success, false if any stage fails.
 */
export function sendToAgentSession(agentName: string, text: string): boolean {
  const session = agentSessionName(agentName)
  const socket = agentTmuxSocket(agentName)
  // Upstream security #8: shell helyett execFileSync, hogy a szöveg parsolása
  // a shell-ből kikerüljön. A `-l` flag a tmux-nak jelzi hogy literálisan
  // küldje a text-et (spawn-paste detector marad). \r/\n most már nem okoz
  // bajt, mert nem a host shell értelmezi, hanem a tmux.
  const baseArgs: string[] = socket ? ['-S', socket] : []
  // \r-t szóközre cseréljük (ne nyomjon meg egy Entert idő előtt), más
  // karaktereket a tmux `-l` flag kezeli.
  const safeText = text.replace(/\r/g, ' ')
  const run = (args: string[]): void => {
    execFileSync(TMUX_BIN, [...baseArgs, ...args], { timeout: 10000 })
  }
  try {
    // Escape first to dismiss any TUI dialog (feedback prompt, modal)
    try { run(['send-keys', '-t', session, 'Escape']) } catch { /* ok */ }
    run(['send-keys', '-t', session, 'C-u'])
    run(['send-keys', '-t', session, '-l', safeText])
    run(['send-keys', '-t', session, 'C-m'])
    return true
  } catch {
    return false
  }
}
