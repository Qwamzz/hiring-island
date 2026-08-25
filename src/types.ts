/** One normalised job, as the site consumes it. */
export interface Job {
  id: string
  title: string
  company: string
  /** The employer's own apply URL — never an aggregator redirect where avoidable. */
  applyUrl: string
  /** Which ATS or aggregator this came from. */
  source: string
  /** Greenhouse board token, when known — lets the pipeline deepen coverage later. */
  boardToken: string | null
  postedAt: string | null
  locationLabel: string | null

  /** ISO-3166 alpha-2 codes the employer will hire in. Empty means unknown, NOT unrestricted. */
  countries: string[]
  continents: string[]
  /** The employer explicitly said "anywhere in the world". */
  worldwideOk: boolean
  /** See freedom.ts — the whole point of this site. */
  freedom: FreedomTier

  category: string | null
  seniority: string | null
  commitment: string | null
  salary: SalaryRange | null
  visaSponsorship: boolean | null
  tools: string[]
}

export interface SalaryRange {
  min: number | null
  max: number | null
  currency: string
  /** "yr" | "mo" | "wk" | "day" | "hr" */
  period: string
  /** Normalised to an annual figure so jobs can be compared and sorted. */
  annualMin: number | null
  annualMax: number | null
}

export type FreedomTier =
  | "worldwide"
  | "multi-region"
  | "multi-country"
  | "single-country"
  /** The posting did not say where you may work from. Never guessed at. */
  | "unspecified"

export interface BuildMeta {
  generatedAt: string
  jobCount: number
  companyCount: number
  tierCounts: Record<FreedomTier, number>
  sources: Record<string, number>
  queries: number
  boards: number
}

export interface SiteData {
  meta: BuildMeta
  jobs: Job[]
}
