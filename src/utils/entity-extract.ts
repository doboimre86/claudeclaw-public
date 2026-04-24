/**
 * Lightweight entity extractor for memory content.
 * Regex-based (no LLM cost) — extracts company names, people, domains, amounts.
 *
 * Extracted entities are auto-merged into the memory.keywords field so that
 * future searches for 'Marketingvilag' or 'Vitalux' surface all related memories.
 */

// Ismert projektek/domain-ek — add hozza a sajat projekted domaineit, brand-neveit.
// Az auto-keyword extraction ezek alapjan taggeli a memoriat.
const KNOWN_PROJECTS: string[] = [
  "ClaudeClaw", "Nova", "Zara", "Lexi",
]

// Magyar cégforma-szuffixek — ezek jelzik hogy az előttük álló tokenek cégnév
const COMPANY_SUFFIX = /\b([A-ZÁÉÍÓÖŐÚÜŰ][a-záéíóöőúüű0-9-]+(?:\s+[A-ZÁÉÍÓÖŐÚÜŰ][a-záéíóöőúüű0-9-]+){0,3})\s+(Kft|Bt|Zrt|Nyrt|Zártkörű|Kkt|Evt|Kft\.|Bt\.|Zrt\.)\b/g

// Magyar nevek — nagybetűs szópár kezdettel (pl. 'Nagy Petra', 'Kovács József')
// csak 2 tagú (first + last) mintára illeszkedik
const PERSON_NAME = /\b([A-ZÁÉÍÓÖŐÚÜŰ][a-záéíóöőúüűné]+)\s+([A-ZÁÉÍÓÖŐÚÜŰ][a-záéíóöőúüűné]+)\b/g

// Pénzösszeg magyar formátumban
const AMOUNT_HUF = /\b(\d{1,3}(?:[.\s]\d{3})+|\d{4,9})\s*(Ft|HUF|forint)\b/gi

// Email cím
const EMAIL = /[\w.-]+@[\w.-]+\.[a-z]{2,}/gi

// Dátum YYYY-MM-DD vagy YYYY.MM.DD.
const DATE = /\b(20\d{2})[-.]([01]?\d)[-.]([0-3]?\d)\.?\b/g

export interface ExtractedEntities {
  projects: string[]
  companies: string[]
  people: string[]
  amounts: string[]
  emails: string[]
  dates: string[]
}

export function extractEntities(text: string): ExtractedEntities {
  const result: ExtractedEntities = {
    projects: [],
    companies: [],
    people: [],
    amounts: [],
    emails: [],
    dates: [],
  }

  // Projects: case-insensitive string match
  const lower = text.toLowerCase()
  for (const p of KNOWN_PROJECTS) {
    if (lower.includes(p.toLowerCase())) result.projects.push(p)
  }

  // Companies with Kft/Bt/etc suffix
  let m: RegExpExecArray | null
  const compRe = new RegExp(COMPANY_SUFFIX.source, 'g')
  while ((m = compRe.exec(text)) !== null) {
    result.companies.push(`${m[1]} ${m[2]}`)
  }

  // People: 2-word capitalized pairs (but skip known companies/projects to avoid double-count)
  const personRe = new RegExp(PERSON_NAME.source, 'g')
  while ((m = personRe.exec(text)) !== null) {
    const full = `${m[1]} ${m[2]}`
    const isCompany = result.companies.some(c => c.startsWith(full))
    const isProject = result.projects.some(p => p.includes(full))
    // Common Hungarian stopwords / non-person pairs
    const stopPairs = /^(Szia|Jo|Kedves|Amennyiben|Kuldtem|Kerlek|Koszonom|Holnap|Kesz|Koszi)/i
    if (!isCompany && !isProject && !stopPairs.test(full)) {
      result.people.push(full)
    }
  }

  // Amounts
  const amtRe = new RegExp(AMOUNT_HUF.source, 'gi')
  while ((m = amtRe.exec(text)) !== null) {
    result.amounts.push(m[0])
  }

  // Emails
  const emRe = new RegExp(EMAIL.source, 'gi')
  while ((m = emRe.exec(text)) !== null) {
    result.emails.push(m[0])
  }

  // Dates
  const dateRe = new RegExp(DATE.source, 'g')
  while ((m = dateRe.exec(text)) !== null) {
    result.dates.push(`${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`)
  }

  // Dedupe
  for (const k of Object.keys(result) as (keyof ExtractedEntities)[]) {
    result[k] = [...new Set(result[k])]
  }

  return result
}

/** Merge extracted entities into a keywords string (comma-separated). */
export function entitiesToKeywords(e: ExtractedEntities, existing?: string): string {
  const existing_ = (existing || '').split(/,\s*/).filter(Boolean)
  const all = new Set(existing_)
  for (const p of e.projects) all.add(p)
  for (const c of e.companies) all.add(c)
  for (const person of e.people) all.add(person)
  // Skip amounts, emails, dates from keywords — too noisy
  return [...all].join(', ')
}
