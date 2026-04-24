import * as http from 'node:http'
import { createHash } from "node:crypto"
import { readFileSync } from 'node:fs'
import { extname } from 'node:path'
import { gzipSync, brotliCompressSync } from 'node:zlib'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
}

// Hard body size limit — prevents memory DoS via large POSTs
const MAX_BODY_BYTES = 10 * 1024 * 1024 // 10 MB

export function readBody(req: http.IncomingMessage, maxBytes: number = MAX_BODY_BYTES): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let received = 0
    let aborted = false
    req.on('data', (c: Buffer) => {
      if (aborted) return
      received += c.length
      if (received > maxBytes) {
        aborted = true
        req.destroy()
        reject(Object.assign(new Error('Request body too large'), { statusCode: 413 }))
        return
      }
      chunks.push(c)
    })
    req.on('end', () => { if (!aborted) resolve(Buffer.concat(chunks)) })
    req.on('error', (err) => { if (!aborted) reject(err) })
  })
}

export async function parseJsonBody<T = Record<string, unknown>>(req: http.IncomingMessage): Promise<T> {
  const raw = await readBody(req)
  try {
    return JSON.parse(raw.toString()) as T
  } catch {
    throw Object.assign(new Error('Invalid JSON body'), { statusCode: 400 })
  }
}

export function json(res: http.ServerResponse, data: unknown, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(data))
}

// Mely MIME-eket érdemes tömöríteni (szöveges tartalmak). A képek/fontok már
// tömörítve vannak, nincs értelme újra-tömöríteni.
const COMPRESSIBLE_EXTS = new Set(['.html', '.css', '.js', '.json', '.svg', '.txt', '.md'])

export function serveFile(res: http.ServerResponse, filePath: string, req?: http.IncomingMessage) {
  try {
    const data = readFileSync(filePath)
    const ext = extname(filePath)
    const headers: Record<string, string> = { 'Content-Type': MIME[ext] || 'application/octet-stream' }

    // ETag-based revalidation: short hash from byte length + first/last 64 bytes
    const tagSrc = `${data.length}-${data.subarray(0, 64).toString('hex')}-${data.subarray(-64).toString('hex')}`
    const etag = `\"${createHash('sha1').update(tagSrc).digest('hex').slice(0, 16)}\"`
    headers['ETag'] = etag

    if (ext === '.js' || ext === '.css') {
      // must-revalidate: browser MUST send If-None-Match every time, server replies 304 if etag matches.
      // Avoids the stale-cache trap when we deploy a fix but the browser still uses 1h-old code.
      headers['Cache-Control'] = 'public, max-age=0, must-revalidate'
    } else if (ext === '.html') {
      headers['Cache-Control'] = 'no-cache'
    } else if (ext === '.png' || ext === '.jpg') {
      headers['Cache-Control'] = 'public, max-age=86400'
    }

    // 304 if If-None-Match matches our ETag
    if (req && req.headers['if-none-match'] === etag) {
      res.writeHead(304, headers)
      res.end()
      return
    }

    // Perf #1: Accept-Encoding alapján brotli vagy gzip tömörítés szöveges asset-eknél.
    // 275 KB app.js → ~50 KB br vagy ~64 KB gzip.
    // Vary: Accept-Encoding hogy a CDN / proxy cache tudja.
    let body: Buffer = data
    if (req && COMPRESSIBLE_EXTS.has(ext) && data.length > 1024) {
      const accept = String(req.headers['accept-encoding'] || '').toLowerCase()
      if (accept.includes('br')) {
        body = brotliCompressSync(data)
        headers['Content-Encoding'] = 'br'
        headers['Vary'] = 'Accept-Encoding'
      } else if (accept.includes('gzip')) {
        body = gzipSync(data)
        headers['Content-Encoding'] = 'gzip'
        headers['Vary'] = 'Accept-Encoding'
      }
    }

    res.writeHead(200, headers)
    res.end(body)
  } catch {
    res.writeHead(404)
    res.end('Not found')
  }
}
