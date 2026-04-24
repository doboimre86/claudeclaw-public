import { isAgentRunning, agentSessionName, sendToAgentSession } from '../utils/shell.js'
import { getPendingMessages, markMessageDelivered, markMessageFailed, createAgentMessage } from '../db.js'
import { listAgentNames } from './agent-manager.js'
import { logger } from '../logger.js'
import { wrapTrustedPeer, TRUSTED_PEER_PREAMBLE, sanitizeAgentIdent } from '../utils/prompt-safety.js'

// Broadcast: üzenet küldése az összes futó agentnek (except the sender)
export function broadcastMessage(from: string, content: string): number {
  const agents = listAgentNames()
  const targets = ['nova', ...agents].filter(a => a !== from)
  let sent = 0
  for (const target of targets) {
    if (isAgentRunning(target)) {
      createAgentMessage(from, target, content)
      sent++
    }
  }
  logger.info({ from, sent, targets: targets.length }, 'Broadcast üzenet küldve')
  return sent
}

export function startMessageRouter(): NodeJS.Timeout {
  return setInterval(() => {
    const pending = getPendingMessages()
    for (const msg of pending) {
      const session = agentSessionName(msg.to_agent)
      if (!isAgentRunning(msg.to_agent)) {
        continue
      }

      // Agent-to-agent üzenet: csapattárs (trusted-peer), NEM untrusted.
      // A régi wrapUntrusted a legitim leader→member utasításokat is prompt-
      // injection-gyanúsnak jelölte (upstream #24). A <trusted-peer> coworker
      // kontextust ad: a címzett az intent szerint válaszol, de irreverzibilis
      // / veszélyes kéréseket Owner felé eszkalálja.
      const safeIdent = sanitizeAgentIdent(msg.from_agent)
      const prefix = TRUSTED_PEER_PREAMBLE + `\n[Üzenet @${safeIdent}-tól, válaszolj: msg_id=${msg.id}]:\n`
      const fullMsg = prefix + wrapTrustedPeer(`agent:${safeIdent}`, msg.content)

      // Reliable 3-stage injection (C-u clear, -l literal, sleep, C-m submit)
      if (sendToAgentSession(msg.to_agent, fullMsg)) {
        markMessageDelivered(msg.id)
        logger.info({ id: msg.id, from: msg.from_agent, to: msg.to_agent, session }, 'Agent üzenet kézbesítve')
      } else {
        logger.warn({ id: msg.id }, 'Üzenet kézbesítés sikertelen')
        markMessageFailed(msg.id, 'Nem sikerült a tmux session-be injektálni')
      }
    }
  }, 5000)
}
