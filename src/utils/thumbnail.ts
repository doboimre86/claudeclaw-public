import { existsSync, statSync, mkdirSync, unlinkSync, readdirSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { logger } from '../logger.js'

/**
 * Generate (or return cached) WebP thumbnail for an avatar image.
 * Cache lives next to the source: <dir>/.thumbs/<basename>-<size>.webp
 *
 * Returns the cached thumbnail path. Falls back to the original on any error.
 */
export async function getOrCreateAvatarThumb(srcPath: string, size = 128): Promise<string> {
  if (!existsSync(srcPath)) return srcPath
  const dir = dirname(srcPath)
  const thumbDir = join(dir, '.thumbs')
  const base = basename(srcPath).replace(/\.\w+$/, '')
  const thumbPath = join(thumbDir, `${base}-${size}.webp`)

  // Cache hit: thumb exists AND is newer than source
  if (existsSync(thumbPath)) {
    try {
      if (statSync(thumbPath).mtimeMs >= statSync(srcPath).mtimeMs) return thumbPath
    } catch { /* fall through */ }
  }

  try {
    mkdirSync(thumbDir, { recursive: true })
    const sharp = (await import('sharp')).default
    await sharp(srcPath, { failOn: 'none' })
      .rotate()                          // honor EXIF orientation
      .resize(size, size, { fit: 'cover', position: 'center' })
      .webp({ quality: 82 })
      .toFile(thumbPath)
    return thumbPath
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err), srcPath, size }, 'Thumbnail generation failed; serving original')
    return srcPath
  }
}

/** Invalidate every thumbnail cached for the given source path. */
export function invalidateThumbsForSource(srcPath: string): void {
  const dir = dirname(srcPath)
  const thumbDir = join(dir, '.thumbs')
  if (!existsSync(thumbDir)) return
  const base = basename(srcPath).replace(/\.\w+$/, '')
  try {
    for (const f of readdirSync(thumbDir)) {
      if (f.startsWith(base + '-') && f.endsWith('.webp')) {
        try { unlinkSync(join(thumbDir, f)) } catch { /* ok */ }
      }
    }
  } catch { /* ok */ }
}
