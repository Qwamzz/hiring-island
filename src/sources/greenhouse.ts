import { classifyFreedom } from "../freedom.js"
import type { Job } from "../types.js"

/**
 * Greenhouse source — the official public Job Board API.
 *
 *   https://boards-api.greenhouse.io/v1/boards/<token>/jobs
 *
 * Documented, unauthenticated, and intended for exactly this kind of reuse:
 * no scraping, no ToS caveat. What it does not offer is cross-company search,
 * so we sweep the board list in boards.txt.
 *
 * Greenhouse has no structured geography field — location is free text like
 * "Remote, United States" or "Remote - EMEA". So unlike the HiringCafe source,
 * countries here are inferred from that string, and we are deliberately
 * conservative: an unrecognised location yields no country codes, which lands
 * the job in "unspecified" rather than flattering it into "worldwide".
 */

const API = "https://boards-api.greenhouse.io/v1/boards"
const UA = "Mozilla/5.0 (compatible; hiring-island-bot/1.0; +https://github.com/Qwamzz/hiring-island)"

async function jsonFetch<T = any>(url: string): Promise<T | null> {
  const maxRetries = 5
  let delay = 700
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(25000),
    })
    if (res.status === 429 || res.status >= 500) {
      if (attempt === maxRetries) throw new Error(`${url} -> ${res.status}`)
      await new Promise((r) => setTimeout(r, delay + Math.floor(Math.random() * 500)))
      delay = Math.min(delay * 2, 8000)
      continue
    }
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`${url} -> ${res.status}`)
    return (await res.json()) as T
  }
  return null
}

/**
 * US detection has to be generous, because Greenhouse boards almost never
 * write "United States" — they write "San Francisco, CA" or "Remote - NY".
 * Missing these was what let 186 US-only roles be graded "work from anywhere"
 * on the first build.
 *
 * State codes are matched **case-sensitively**, and that is not a nicety: with
 * an /i flag, `\bIN\b` matches the English word "in" and `\bOR\b` matches
 * "or", so "anywhere in the world" parses as Indiana. Real postings write
 * state codes in caps; lowercase two-letter words are just English.
 */
const US_STATE_CODES =
  /\b(?:AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)\b/

const US_NAMES =
  /\bunited states\b|\bu\.s\.a?\.?|\busa\b|\bsan francisco\b|\bnew york\b|\bnyc\b|\bseattle\b|\bboston\b|\baustin\b|\bchicago\b|\blos angeles\b|\bdenver\b|\batlanta\b|\bwashington,? d\.?c\.?|\bbay area\b|\bcalifornia\b|\btexas\b|\bflorida\b|\bnew jersey\b|\billinois\b|\bmassachusetts\b/i

/** Bare uppercase "US" — separate so it stays case-sensitive like state codes. */
const US_ABBREV = /\bUS\b/

export function looksUS(location: string): boolean {
  return US_NAMES.test(location) || US_STATE_CODES.test(location) || US_ABBREV.test(location)
}

/** Free-text location → country codes. */
const COUNTRY_PATTERNS: Array<[RegExp, string, string]> = [
  [/\bunited kingdom\b|\bu\.?k\.?\b|\bengland\b|\blondon\b/i, "GB", "Europe"],
  [/\bcanada\b|\bcanadian\b|\btoronto\b|\bvancouver\b/i, "CA", "North America"],
  [/\bgermany\b|\bberlin\b|\bmunich\b/i, "DE", "Europe"],
  [/\bnetherlands\b|\bamsterdam\b/i, "NL", "Europe"],
  [/\bfrance\b|\bparis\b/i, "FR", "Europe"],
  [/\bspain\b|\bmadrid\b|\bbarcelona\b/i, "ES", "Europe"],
  [/\bireland\b|\bdublin\b/i, "IE", "Europe"],
  [/\bpoland\b|\bwarsaw\b|\bkrakow\b/i, "PL", "Europe"],
  [/\bportugal\b|\blisbon\b/i, "PT", "Europe"],
  [/\bukraine\b|\bkyiv\b|\bkiev\b/i, "UA", "Europe"],
  [/\bswitzerland\b|\bzurich\b|\bgeneva\b/i, "CH", "Europe"],
  [/\bromania\b|\bbucharest\b/i, "RO", "Europe"],
  [/\bsweden\b|\bstockholm\b/i, "SE", "Europe"],
  [/\bnorway\b|\boslo\b/i, "NO", "Europe"],
  [/\bdenmark\b|\bcopenhagen\b/i, "DK", "Europe"],
  [/\bfinland\b|\bhelsinki\b/i, "FI", "Europe"],
  [/\bitaly\b|\bmilan\b|\brome\b/i, "IT", "Europe"],
  [/\bindia\b|\bbengaluru\b|\bbangalore\b/i, "IN", "Asia"],
  [/\bsingapore\b/i, "SG", "Asia"],
  [/\bjapan\b|\btokyo\b/i, "JP", "Asia"],
  [/\bisrael\b|\btel aviv\b/i, "IL", "Asia"],
  [/\bphilippines\b|\bmanila\b/i, "PH", "Asia"],
  [/\bpakistan\b|\blahore\b|\bkarachi\b/i, "PK", "Asia"],
  [/\baustralia\b|\bsydney\b|\bmelbourne\b/i, "AU", "Oceania"],
  [/\bnew zealand\b/i, "NZ", "Oceania"],
  [/\bbrazil\b|\bbrasil\b/i, "BR", "South America"],
  [/\bargentina\b|\bbuenos aires\b/i, "AR", "South America"],
  [/\bcolombia\b|\bbogot/i, "CO", "South America"],
  [/\bmexico\b/i, "MX", "North America"],
  [/\bsouth africa\b/i, "ZA", "Africa"],
  [/\bnigeria\b|\blagos\b/i, "NG", "Africa"],
  [/\bkenya\b|\bnairobi\b/i, "KE", "Africa"],
  [/\bghana\b|\baccra\b/i, "GH", "Africa"],
  [/\begypt\b|\bcairo\b/i, "EG", "Africa"],
]

/** Region words that stand in for a set of countries rather than one. */
const REGION_PATTERNS: Array<[RegExp, string]> = [
  [/\bemea\b/i, "Europe"],
  [/\bapac\b/i, "Asia"],
  [/\bamer\b|\bamericas\b|\bnamer\b/i, "North America"],
  [/\blatam\b/i, "South America"],
  [/\beurope\b|\beuropean\b/i, "Europe"],
]

/**
 * Bare "anywhere" is NOT a worldwide claim. "Ukraine Anywhere" and
 * "US - Anywhere" are real Greenhouse location strings, and both mean
 * "anywhere inside this one country" — the first build promoted a Lyft role in
 * Ukraine to the top tier on exactly that basis. Require a phrase that can
 * only mean the whole world.
 */
const WORLDWIDE =
  /\banywhere in the world\b|\bworldwide\b|\bglobal(?:ly)?\b|\bany country\b|\banywhere on earth\b/i

export function readGeography(location: string): {
  countries: string[]
  continents: string[]
  worldwideOk: boolean
} {
  const countries = new Set<string>()
  const continents = new Set<string>()

  if (looksUS(location)) {
    countries.add("US")
    continents.add("North America")
  }

  for (const [re, code, continent] of COUNTRY_PATTERNS) {
    if (re.test(location)) {
      countries.add(code)
      continents.add(continent)
    }
  }
  for (const [re, continent] of REGION_PATTERNS) {
    if (re.test(location)) continents.add(continent)
  }

  // A whole-world phrase only counts when no specific country is also named.
  const worldwideOk = WORLDWIDE.test(location) && countries.size === 0

  return { countries: [...countries], continents: [...continents], worldwideOk }
}

/**
 * Does this posting read as remote at all? Greenhouse has no remote flag, so
 * this is a text judgement — and it is deliberately strict.
 *
 * "Remote-Friendly (Travel-Required) | San Francisco, CA" is an office job
 * with a flexible day, not a remote job. "NYC or Remote" is a choice offered
 * to someone already near NYC. Both were in the first build; both are out now.
 */
const NOT_REMOTE = /\bhybrid\b|\bon-?site\b|\bin[- ]office\b|\bremote[- ]friendly\b|\btravel[- ]required\b/i
const IS_REMOTE = /\bremote\b|\bdistributed\b|\banywhere\b|\bwork from home\b|\bwfh\b/i

export function looksRemote(location: string, title: string): boolean {
  const hay = `${location} ${title}`
  if (NOT_REMOTE.test(hay)) return false
  if (!IS_REMOTE.test(hay)) return false
  // "X or Remote" / "Remote or X" offers remote as an alternative to an office,
  // which in practice means "near that office". Not a work-from-anywhere role.
  if (/\bor remote\b|\bremote or\b/i.test(hay)) return false
  return true
}

export async function harvestBoard(board: string): Promise<Job[]> {
  const data = await jsonFetch<{ jobs?: any[] }>(`${API}/${encodeURIComponent(board)}/jobs`)
  if (!data) return []

  const jobs: Job[] = []
  for (const raw of Array.isArray(data.jobs) ? data.jobs : []) {
    try {
      if (raw?.id === undefined || !raw.title) continue
      const location = raw.location?.name ?? ""
      const title = String(raw.title)
      if (!looksRemote(location, title)) continue

      const { countries, continents, worldwideOk } = readGeography(location)

      jobs.push({
        id: `gh:${board}:${raw.id}`,
        title,
        company: raw.company_name ?? board,
        applyUrl: raw.absolute_url ?? `https://job-boards.greenhouse.io/${board}/jobs/${raw.id}`,
        source: "greenhouse",
        boardToken: board,
        postedAt: raw.first_published ?? raw.updated_at ?? null,
        locationLabel: location || null,
        countries,
        continents,
        worldwideOk,
        freedom: classifyFreedom(worldwideOk, countries, continents),
        category: Array.isArray(raw.departments) && raw.departments[0]?.name ? raw.departments[0].name : null,
        seniority: null,
        commitment: null,
        salary: null,
        visaSponsorship: null,
        tools: [],
      })
    } catch {
      // One malformed posting must not discard the board.
    }
  }
  return jobs
}

/** Run `worker` over `items` with a bounded number of in-flight requests. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (true) {
        const i = next++
        if (i >= items.length) return
        results[i] = await worker(items[i])
      }
    }),
  )
  return results
}
