import { classifyFreedom } from "../freedom.js"
import type { Job, SalaryRange } from "../types.js"

/**
 * HiringCafe source.
 *
 * Their private search API needs a session credential, but the server-rendered
 * SEO pages under /jobs/<keyword>-remote embed the complete result objects in
 * a __NEXT_DATA__ JSON island. That island carries the geographic fields this
 * whole site is built on — workplace_countries, workplace_continents,
 * is_workplace_worldwide_ok — which the visible card markup does not show.
 *
 * Endpoint notes and field paths: see docs/sources.md.
 */

const BASE = "https://hiring.cafe"
const UA = "Mozilla/5.0 (compatible; hiring-island-bot/1.0; +https://github.com/Qwamzz/hiring-island)"

export async function fetchPage(slug: string, page: number): Promise<string> {
  const url = page === 0 ? `${BASE}/jobs/${slug}` : `${BASE}/jobs/${slug}?page=${page}`
  const maxRetries = 5
  let delay = 800
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(25000),
    })
    if (res.status === 429 || res.status >= 500) {
      if (attempt === maxRetries) throw new Error(`${url} -> ${res.status}`)
      await new Promise((r) => setTimeout(r, delay + Math.floor(Math.random() * 600)))
      delay = Math.min(delay * 2, 10000)
      continue
    }
    if (res.status === 404) return ""
    if (!res.ok) throw new Error(`${url} -> ${res.status}`)
    return res.text()
  }
  return ""
}

function extractNextData(html: string): any | null {
  const m = html.match(
    /<script id="__NEXT_DATA__" type="application\/json"[^>]*>([\s\S]*?)<\/script>/i,
  )
  if (!m) return null
  try {
    return JSON.parse(m[1])
  } catch {
    return null
  }
}

/** Canonical posting anchors, in document order — they pair with ssrHits. */
function jobHrefs(html: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const m of html.matchAll(/href="(\/job\/[^"#?]+)"/g)) {
    if (seen.has(m[1])) continue
    seen.add(m[1])
    out.push(m[1])
  }
  return out
}

const PERIODS: Array<[string, string, number]> = [
  // [field prefix, label, multiplier to annualise]
  ["yearly", "yr", 1],
  ["monthly", "mo", 12],
  ["weekly", "wk", 52],
  ["daily", "day", 260],
  ["hourly", "hr", 2080],
]

function readSalary(v: Record<string, any>): SalaryRange | null {
  const currency = typeof v.listed_compensation_currency === "string" ? v.listed_compensation_currency : "USD"
  for (const [key, period, mult] of PERIODS) {
    const rawMin = v[`${key}_min_compensation`]
    const rawMax = v[`${key}_max_compensation`]
    const min = typeof rawMin === "number" && isFinite(rawMin) ? Math.round(rawMin) : null
    const max = typeof rawMax === "number" && isFinite(rawMax) ? Math.round(rawMax) : null
    if (min === null && max === null) continue
    return {
      min,
      max,
      currency,
      period,
      annualMin: min === null ? null : Math.round(min * mult),
      annualMax: max === null ? null : Math.round(max * mult),
    }
  }
  return null
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.length > 0) : []
}

export function mapHit(hit: any, canonicalUrl: string | null): Job | null {
  if (!hit || typeof hit !== "object") return null
  if (hit.is_expired === true) return null

  const id = typeof hit.id === "string" ? hit.id : hit.objectID
  const v = hit.v5_processed_job_data ?? {}
  const title = hit.job_information?.title ?? hit.job_information?.job_title_raw ?? v.core_job_title
  const company = v.company_name ?? hit.enriched_company_data?.name
  if (!id || !title || !company) return null

  // Remote only. This is a remote-jobs board; on-site and hybrid postings are
  // not "work from anywhere" under any reading.
  const workplaceType = typeof v.workplace_type === "string" ? v.workplace_type : ""
  if (workplaceType.toLowerCase() !== "remote") return null

  const countries = strings(v.workplace_countries)
  const continents = strings(v.workplace_continents)
  const worldwideOk = v.is_workplace_worldwide_ok === true

  return {
    id: `hc:${id}`,
    title: String(title),
    company: String(company),
    applyUrl: typeof hit.apply_url === "string" && hit.apply_url ? hit.apply_url : `${BASE}${canonicalUrl ?? ""}`,
    source: normaliseSource(hit.source),
    boardToken: typeof hit.board_token === "string" ? hit.board_token : null,
    postedAt: typeof v.estimated_publish_date === "string" ? v.estimated_publish_date : null,
    locationLabel: v.formatted_workplace_location ?? null,
    countries,
    continents,
    worldwideOk,
    freedom: classifyFreedom(worldwideOk, countries, continents),
    category: v.job_category ?? null,
    seniority: v.seniority_level ?? null,
    commitment: Array.isArray(v.commitment) && v.commitment.length ? v.commitment.join(", ") : null,
    salary: readSalary(v),
    visaSponsorship: typeof v.visa_sponsorship === "boolean" ? v.visa_sponsorship : null,
    tools: strings(v.technical_tools).slice(0, 12),
  }
}

/** HiringCafe spells the same ATS several ways ("grnhse", "greenhouse"). */
const SOURCE_ALIASES: Record<string, string> = {
  grnhse: "greenhouse",
  greenhouse: "greenhouse",
  gh: "greenhouse",
  lever: "lever",
  ashby: "ashby",
  workday: "workday",
  smartrecruiters: "smartrecruiters",
}

export function normaliseSource(raw: unknown): string {
  if (typeof raw !== "string" || !raw) return "hiringcafe"
  const key = raw.toLowerCase()
  return SOURCE_ALIASES[key] ?? key
}

function slugify(text: string): string {
  return text
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

/**
 * Sweep one keyword across N pages of HiringCafe's remote listing.
 * Pages are 20 results each and 0-indexed server-side.
 */
export async function harvest(keyword: string, pages: number): Promise<Job[]> {
  const slug = `${slugify(keyword)}-remote`
  const jobs: Job[] = []

  for (let page = 0; page < pages; page++) {
    const html = await fetchPage(slug, page)
    if (!html) break

    const data = extractNextData(html)
    const pp = data?.props?.pageProps
    const hits = Array.isArray(pp?.ssrHits) ? pp.ssrHits : []
    if (hits.length === 0) break

    const hrefs = jobHrefs(html)
    for (let i = 0; i < hits.length; i++) {
      try {
        // Only trust the positional anchor when its slug matches the title.
        const href = hrefs[i]
        const hit = hits[i]
        const rawTitle = hit?.job_information?.title ?? ""
        const ok = href && href.slice("/job/".length).startsWith(slugify(String(rawTitle)).slice(0, 20))
        const job = mapHit(hit, ok ? href : null)
        if (job) jobs.push(job)
      } catch {
        // One malformed record must not discard the page.
      }
    }

    if (pp?.ssrIsLastPage === true) break
    // Deliberately unhurried: this runs once a day in CI, not interactively.
    await new Promise((r) => setTimeout(r, 700))
  }

  return jobs
}
