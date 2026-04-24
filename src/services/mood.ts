import { getDb } from '../db.js'

export type Mood = 'happy' | 'alert' | 'curious' | 'calm' | 'tired' | 'cautious' | 'sad' | 'focused' | 'neutral'

export interface AgentState {
  agent_id: string
  mood: Mood
  energy: number          // 0-100
  last_feedback: string | null
  last_feedback_at: number | null
  updated_at: number
}

/**
 * Compute time-of-day mood + energy baseline.
 * 06-09: alert (high energy)
 * 09-12: focused
 * 12-14: alert (post-lunch dip handled with energy)
 * 14-17: focused
 * 17-21: calm
 * 21-23: tired
 * 23-06: tired (deep night)
 */
function timeOfDayBaseline(now = new Date()): { mood: Mood; energy: number } {
  const h = now.getHours()
  if (h >= 6 && h < 9)  return { mood: 'alert',   energy: 75 }
  if (h >= 9 && h < 12) return { mood: 'focused', energy: 80 }
  if (h >= 12 && h < 14) return { mood: 'alert',  energy: 60 }
  if (h >= 14 && h < 17) return { mood: 'focused', energy: 70 }
  if (h >= 17 && h < 21) return { mood: 'calm',    energy: 50 }
  if (h >= 21 && h < 23) return { mood: 'tired',   energy: 30 }
  return { mood: 'tired', energy: 15 }   // 23-06
}

/** Apply feedback delta to baseline state. */
function applyFeedback(baseline: { mood: Mood; energy: number }, fb: string | null): { mood: Mood; energy: number } {
  if (!fb) return baseline
  const lower = fb.toLowerCase()
  // Praise -> happy / energy up
  if (/(jó|szuper|király|köszi|köszönöm|tökéletes|nagyszerű|ügyes)/i.test(lower)) {
    return { mood: 'happy', energy: Math.min(100, baseline.energy + 15) }
  }
  // Criticism -> cautious / energy down
  if (/(rossz|szar|hibás|hülye|nem|fasz|baszott|kibasz|elcse)/i.test(lower)) {
    return { mood: 'cautious', energy: Math.max(10, baseline.energy - 20) }
  }
  // Question / curious
  if (/(\?|miért|hogyan|mikor|hol|mi az|mit jelent)/i.test(lower)) {
    return { mood: 'curious', energy: baseline.energy }
  }
  return baseline
}

/** Read or compute current state for an agent. Auto-refreshes if stale (>10 min). */
export function getAgentMood(agentId: string): AgentState {
  const db = getDb()
  const row = db.prepare('SELECT * FROM agent_state WHERE agent_id = ?').get(agentId) as AgentState | undefined
  const now = Math.floor(Date.now() / 1000)
  const stale = !row || (now - row.updated_at) > 600   // >10 min stale -> recompute baseline
  if (stale) {
    const baseline = timeOfDayBaseline()
    const fb = row?.last_feedback ?? null
    const fbAge = row?.last_feedback_at ? now - row.last_feedback_at : Infinity
    // Feedback decays after 1h
    const computed = fbAge < 3600 ? applyFeedback(baseline, fb) : baseline
    db.prepare(`
      INSERT INTO agent_state (agent_id, mood, energy, last_feedback, last_feedback_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(agent_id) DO UPDATE SET mood=excluded.mood, energy=excluded.energy, updated_at=excluded.updated_at
    `).run(agentId, computed.mood, computed.energy, fb, row?.last_feedback_at ?? null, now)
    return {
      agent_id: agentId,
      mood: computed.mood,
      energy: computed.energy,
      last_feedback: fb,
      last_feedback_at: row?.last_feedback_at ?? null,
      updated_at: now,
    }
  }
  return row
}

/** Record a feedback message + recompute mood. */
export function recordFeedback(agentId: string, feedback: string): AgentState {
  const db = getDb()
  const now = Math.floor(Date.now() / 1000)
  const baseline = timeOfDayBaseline()
  const computed = applyFeedback(baseline, feedback)
  db.prepare(`
    INSERT INTO agent_state (agent_id, mood, energy, last_feedback, last_feedback_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(agent_id) DO UPDATE SET
      mood=excluded.mood, energy=excluded.energy,
      last_feedback=excluded.last_feedback, last_feedback_at=excluded.last_feedback_at,
      updated_at=excluded.updated_at
  `).run(agentId, computed.mood, computed.energy, feedback.slice(0, 200), now, now)
  return {
    agent_id: agentId,
    mood: computed.mood,
    energy: computed.energy,
    last_feedback: feedback.slice(0, 200),
    last_feedback_at: now,
    updated_at: now,
  }
}

export const MOOD_EMOJI: Record<Mood, string> = {
  happy:   '😊',
  alert:   '🌟',
  curious: '🧐',
  calm:    '😌',
  tired:   '😴',
  cautious: '😬',
  sad:     '😔',
  focused: '🎯',
  neutral: '😐',
}
