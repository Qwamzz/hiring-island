import type { FreedomTier, Job } from "./types.js"

/**
 * The premise of this site.
 *
 * "Remote" is close to meaningless as a filter: in a sample of 20 remote
 * software-engineer postings, 18 were open to one country only. A job that is
 * "remote (US only)" and a job you can genuinely do from anywhere are
 * different products sharing a label, and every major board sorts them into
 * the same bucket.
 *
 * So we grade postings by how much geography they actually free you from, and
 * we say it on the card. A single-country role is not hidden — it is labelled
 * honestly, and it sorts below the ones that aren't.
 *
 * The rule that makes the grade trustworthy: **absence of data is never
 * evidence of freedom.** A posting that lists no countries is `unspecified`,
 * not `worldwide`. Only an explicit "anywhere/worldwide/global" earns the top
 * tier. Getting this backwards is the one bug that would make the whole site
 * lie, and it is exactly the bug the first build shipped — 186 "work from
 * anywhere" roles that were really "San Francisco, travel required".
 */

export function classifyFreedom(
  worldwideOk: boolean,
  countries: string[],
  continents: string[],
): FreedomTier {
  if (worldwideOk) return "worldwide"
  if (countries.length === 0) {
    // We could not determine the geography. Say so; do not flatter the job.
    // A stated region with no country codes ("EMEA") is still real signal.
    return continents.length >= 2 ? "multi-region" : "unspecified"
  }
  // Country count is the primary axis. Continents only speak when no country
  // was named — otherwise "US + Switzerland" would read as "multi-region" on
  // the badge while the detail line said "US + CH", which is just confusing.
  if (countries.length >= 3) return "multi-region"
  if (countries.length === 2) return "multi-country"
  return "single-country"
}

export const TIER_RANK: Record<FreedomTier, number> = {
  worldwide: 0,
  "multi-region": 1,
  "multi-country": 2,
  "single-country": 3,
  unspecified: 4,
}

export const TIER_LABEL: Record<FreedomTier, string> = {
  worldwide: "Work from anywhere",
  "multi-region": "Multi-region",
  "multi-country": "Two countries",
  "single-country": "Single country",
  unspecified: "Location unstated",
}

/**
 * A short, honest description of the geographic constraint, e.g.
 * "US only", "US + Canada", "6 countries · North America, Europe".
 */
export function freedomDetail(job: Job): string {
  if (job.worldwideOk) return "Anywhere in the world"
  if (job.countries.length === 0) {
    return job.continents.length ? job.continents.join(", ") : "Posting does not say"
  }
  if (job.countries.length === 1) return `${job.countries[0]} only`
  if (job.countries.length === 2) return `${job.countries[0]} + ${job.countries[1]}`
  const where = job.continents.length ? ` · ${job.continents.join(", ")}` : ""
  return `${job.countries.length} countries${where}`
}

/**
 * Sort: freedom first, then salary (higher first, unknown last), then
 * recency. Freedom leads deliberately — it is the axis this site exists to
 * surface, and sorting by date would bury it under whatever posted today.
 */
export function compareJobs(a: Job, b: Job): number {
  const tier = TIER_RANK[a.freedom] - TIER_RANK[b.freedom]
  if (tier !== 0) return tier

  const aPay = a.salary?.annualMax ?? a.salary?.annualMin ?? -1
  const bPay = b.salary?.annualMax ?? b.salary?.annualMin ?? -1
  if (aPay !== bPay) return bPay - aPay

  return Date.parse(b.postedAt ?? "") - Date.parse(a.postedAt ?? "") || 0
}
