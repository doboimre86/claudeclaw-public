import type { IncomingMessage, ServerResponse } from "node:http"

const SESSION_COOKIE = "cc_session"

/**
 * Parse a single cookie value out of the Cookie header.
 * Returns null if missing.
 */
export function getCookie(req: IncomingMessage, name: string): string | null {
  const raw = req.headers.cookie
  if (!raw) return null
  const pairs = raw.split(";")
  for (const pair of pairs) {
    const eq = pair.indexOf("=")
    if (eq < 0) continue
    const k = pair.slice(0, eq).trim()
    if (k !== name) continue
    return decodeURIComponent(pair.slice(eq + 1).trim())
  }
  return null
}

export function getSessionToken(req: IncomingMessage): string | null {
  return getCookie(req, SESSION_COOKIE)
}

/** True if the request was forwarded via TLS (Traefik sets x-forwarded-proto). */
function isSecureRequest(req: IncomingMessage): boolean {
  const proto = req.headers["x-forwarded-proto"]
  if (typeof proto === "string" && proto.toLowerCase() === "https") return true
  // Fallback: connection.encrypted (when not behind a proxy)
  const conn = (req.socket as unknown as { encrypted?: boolean }) ?? {}
  return Boolean(conn.encrypted)
}

export function setSessionCookie(req: IncomingMessage, res: ServerResponse, token: string, maxAgeSec = 30 * 24 * 60 * 60) {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${maxAgeSec}`,
  ]
  if (isSecureRequest(req)) parts.push("Secure")
  appendCookieHeader(res, parts.join("; "))
}

export function clearSessionCookie(req: IncomingMessage, res: ServerResponse) {
  const parts = [
    `${SESSION_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    "Max-Age=0",
  ]
  if (isSecureRequest(req)) parts.push("Secure")
  appendCookieHeader(res, parts.join("; "))
}

function appendCookieHeader(res: ServerResponse, cookie: string) {
  const existing = res.getHeader("Set-Cookie")
  if (Array.isArray(existing)) res.setHeader("Set-Cookie", [...existing, cookie])
  else if (typeof existing === "string") res.setHeader("Set-Cookie", [existing, cookie])
  else res.setHeader("Set-Cookie", cookie)
}

export const SESSION_COOKIE_NAME = SESSION_COOKIE
