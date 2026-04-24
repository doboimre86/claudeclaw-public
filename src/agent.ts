import { query } from '@anthropic-ai/claude-agent-sdk'
import { PROJECT_ROOT } from './config.js'

const TYPING_REFRESH_MS = 4000
import { logger } from './logger.js'
import { logUsage } from './db.js'

const AGENT_TIMEOUT_MS = 10 * 60 * 1000 // 10 minutes max (scheduler/session rotation)

export interface AgentResult {
  text: string | null
  newSessionId?: string
  usage?: { inputTokens: number; outputTokens: number; costUsd: number }
}

export async function runAgent(
  message: string,
  sessionId?: string,
  onTyping?: () => void,
  onText?: (chunk: string) => void
): Promise<AgentResult> {
  let newSessionId: string | undefined
  let resultText: string | null = null
  let totalCost = 0
  let totalInput = 0
  let totalOutput = 0

  const typingInterval = onTyping ? setInterval(onTyping, TYPING_REFRESH_MS) : undefined
  const abortController = new AbortController()
  const timeout = setTimeout(() => {
    logger.warn('Agent timeout (10 perc), megszakitas...')
    abortController.abort()
  }, AGENT_TIMEOUT_MS)

  try {
    const events = query({
      prompt: message,
      options: {
        abortController,
        cwd: PROJECT_ROOT,
        permissionMode: 'acceptEdits',
        ...(sessionId ? { resume: sessionId } : {}),
      },
    })

    for await (const event of events) {
      if (event.type === 'system' && 'subtype' in event && (event as { subtype?: string }).subtype === 'init') {
        newSessionId = (event as { sessionId?: string }).sessionId
      }
      if (event.type === 'assistant' && 'content' in event) {
        const content = (event as { content?: Array<{ type: string; text?: string }> }).content
        if (content) {
          for (const block of content) {
            if (block.type === 'text' && block.text && onText) onText(block.text)
          }
        }
      }
      if (event.type === 'result') {
        resultText = 'result' in event ? (event as { result?: string }).result ?? null : null
        // Extract usage data
        const ev = event as { total_cost_usd?: number; usage?: { input_tokens?: number; output_tokens?: number } }
        if (ev.total_cost_usd) totalCost = ev.total_cost_usd
        if (ev.usage) {
          totalInput = ev.usage.input_tokens || 0
          totalOutput = ev.usage.output_tokens || 0
        }
      }
    }
  } catch (err: unknown) {
    if ((err instanceof Error && err.name === 'AbortError') || abortController.signal.aborted) {
      logger.warn('Agent megszakitva timeout miatt')
      resultText = 'A feldolgozas tullepte a 10 perces idokorlatot. Probald rovidebben megfogalmazni, vagy bontsd tobb lepesre.'
    } else {
      // Upstream #30: NE nyeljünk el non-timeout hibát csendes fallback-kel.
      // A régi kód egy truthy "Hiba tortent..." stringet adott vissza, ami
      // átcsúszott a hívók `if (!text)` guardján, így pl. generált CLAUDE.md /
      // SOUL.md fájlokba szemét került miközben a dashboard sikert logolt.
      // Most dobjuk tovább a hibát; a hívók try/catch-ben kezelik.
      logger.error({ err: err instanceof Error ? err.message : String(err) }, 'Agent hiba')
      clearTimeout(timeout)
      if (typingInterval) clearInterval(typingInterval)
      throw err instanceof Error ? err : new Error(String(err))
    }
  } finally {
    clearTimeout(timeout)
    if (typingInterval) clearInterval(typingInterval)
  }

  // Log usage if we got any data
  if (totalCost > 0 || totalInput > 0 || totalOutput > 0) {
    try {
      logUsage({ inputTokens: totalInput, outputTokens: totalOutput, costUsd: totalCost, sessionId: newSessionId })
    } catch (err) {
      logger.warn({ err }, 'Failed to log usage')
    }
  }

  return { text: resultText, newSessionId, usage: { inputTokens: totalInput, outputTokens: totalOutput, costUsd: totalCost } }
}
