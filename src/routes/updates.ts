import { execFileSync } from 'node:child_process'
import { PROJECT_ROOT } from '../config.js'
import { json } from '../utils/http.js'
import { logger } from '../logger.js'
import type { RouteContext } from './types.js'

// Dashboard publikus release státusz.
// GET /api/updates/status — a publikus repo (claudeclaw-public) legfrissebb
// release metaadata + hány privát commit vár még anonimizálásra.
//
// FONTOS: a privát és publikus branch DIVERGÁL. A privát fejlesztési history-t
// tartalmaz, a publikus az anonimizált release-ek history-ját. A "behind"
// számot NEM mutatjuk "frissítés pull-olandó"-ként, mert a publikus commit-ok
// szándékosan nem részei a privát tree-nek.
//
// Amit mutatunk: legutóbbi publikus release hash + dátum + subject, valamint
// hány privát commit halmozódott fel az utolsó release óta (ahead).

interface UpdateCommit {
  hash: string
  subject: string
  author: string
  date: string
}

interface UpdateStatus {
  pendingCommits: number  // privát commit-ok amik még nem kerültek publikus release-be (ahead)
  lastRelease: UpdateCommit | null  // utolsó publikus release commit
  pendingList: UpdateCommit[]  // a privát ahead commit-ok (max 20)
  lastCheck: number
  currentBranch: string
  currentHead: string
  error?: string
  /** @deprecated használd: pendingCommits */
  behind?: number
  /** @deprecated használd: pendingCommits */
  ahead?: number
  /** @deprecated */
  commits?: UpdateCommit[]
}

let cached: UpdateStatus | null = null
let cacheTime = 0
const CACHE_TTL_MS = 5 * 60 * 1000  // 5 perc cache — ne ostromolja a GitHubot

// Biztonságos execFileSync wrapper (nincs shell, fix argumentumok).
// SSH kulcs + url.insteadOf konfigurálva a 2026-04-16 ClaudeClaw audit
// memóriájából (a `/root/.ssh/github-claudeclaw` kulcs elvesztette a
// jogát, a `/root/.ssh/github` kulcs működik example-user accountal).
function git(...args: string[]): string {
  return execFileSync('git', [
    '-c', 'url.git@github.com:.insteadOf=git@github-claudeclaw:',
    ...args,
  ], {
    cwd: PROJECT_ROOT,
    timeout: 20_000,
    encoding: 'utf-8',
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
      GIT_SSH_COMMAND: 'ssh -o IdentitiesOnly=yes -i /root/.ssh/github',
    },
  }).trim()
}

function refreshStatus(): UpdateStatus {
  const now = Date.now()
  const status: UpdateStatus = {
    pendingCommits: 0,
    lastRelease: null,
    pendingList: [],
    lastCheck: now,
    currentBranch: '',
    currentHead: '',
  }
  try {
    status.currentBranch = git('rev-parse', '--abbrev-ref', 'HEAD')
    status.currentHead = git('rev-parse', '--short', 'HEAD')
  } catch (err) {
    logger.warn({ err }, 'git HEAD lekérdezés sikertelen')
    status.error = 'Git state unavailable'
    return status
  }
  try {
    // Publikus repo fetch — ahonnan az utolsó release metadata jön.
    git('fetch', 'public', status.currentBranch, '--quiet')
  } catch (err) {
    logger.warn({ err }, 'git fetch public sikertelen')
    status.error = 'Fetch failed (network/auth)'
    return status
  }
  try {
    // 1) Utolsó publikus release (public/<branch> HEAD)
    const lastReleaseLog = git('log', `public/${status.currentBranch}`, '-n', '1', '--pretty=format:%h%x09%s%x09%an%x09%cI')
    if (lastReleaseLog) {
      const [hash, subject, author, date] = lastReleaseLog.split('\t')
      status.lastRelease = { hash: hash ?? '', subject: subject ?? '', author: author ?? '', date: date ?? '' }
    }

    // 2) Privát commit-ok amik az utolsó release óta felhalmozódtak — ezek
    // várnak anonimizálásra + squash-ra + publikus push-ra.
    // Közös ős-től (merge-base) számolunk, nem közvetlen ahead-del, mert a
    // privát és publikus branch-ek SZÁNDÉKOSAN divergálnak (más anonimizálási
    // history). A közös ős óta a privát HEAD felé eső commit-ok a jövő release
    // kandidátjai.
    let pendingRange = `public/${status.currentBranch}..HEAD`
    try {
      const mergeBase = git('merge-base', 'HEAD', `public/${status.currentBranch}`)
      if (mergeBase) pendingRange = `${mergeBase}..HEAD`
    } catch { /* ha nincs közös ős, maradunk a közvetlen ahead-en */ }

    const pendingStr = git('rev-list', '--count', pendingRange)
    status.pendingCommits = Number.parseInt(pendingStr, 10) || 0

    if (status.pendingCommits > 0) {
      const log = git('log', pendingRange, '--pretty=format:%h%x09%s%x09%an%x09%cI', '-n', '20')
      if (log) {
        status.pendingList = log.split('\n').map((line) => {
          const [hash, subject, author, date] = line.split('\t')
          return { hash: hash ?? '', subject: subject ?? '', author: author ?? '', date: date ?? '' }
        })
      }
    }

    // Backward-compat: régi kliensek ahead/behind/commits-t várhatnak
    status.ahead = status.pendingCommits
    status.behind = 0  // NEM mutatunk behind-et, a divergált history miatt félrevezető lenne
    status.commits = status.pendingList
  } catch (err) {
    logger.warn({ err }, 'Update status számítás sikertelen')
    status.error = 'Status calculation failed'
  }
  return status
}

export async function updatesRoutes(ctx: RouteContext): Promise<boolean> {
  const { path, method, res } = ctx

  if (path === '/api/updates/status' && method === 'GET') {
    const now = Date.now()
    if (cached && now - cacheTime < CACHE_TTL_MS) {
      json(res, cached)
      return true
    }
    cached = refreshStatus()
    cacheTime = now
    json(res, cached)
    return true
  }

  return false
}
