import { describe, expect, test } from "bun:test"
import { classifyFreedom, compareJobs, freedomDetail, TIER_RANK } from "../src/freedom"
import { looksRemote, readGeography } from "../src/sources/greenhouse"
import { mapHit } from "../src/sources/hiringcafe"
import type { Job } from "../src/types"

/**
 * These tests guard the only claim this site makes. If the freedom grade is
 * wrong, the site is worse than useless — it is confidently misleading.
 *
 * The regression they exist for: the first build graded 186 US-only roles as
 * "work from anywhere" because an empty country list was read as "no
 * restriction" rather than "we don't know", and because the Greenhouse
 * location parser did not recognise "San Francisco, CA" as the United States.
 */

describe("classifyFreedom — absence of data is never evidence of freedom", () => {
  test("an empty country list is unspecified, NOT worldwide", () => {
    expect(classifyFreedom(false, [], [])).toBe("unspecified")
  })

  test("only an explicit worldwide flag earns the top tier", () => {
    expect(classifyFreedom(true, [], [])).toBe("worldwide")
  })

  test("a stated multi-continent region counts even with no country codes", () => {
    expect(classifyFreedom(false, [], ["Europe", "Asia"])).toBe("multi-region")
  })

  test("one continent alone is not enough to claim multi-region", () => {
    expect(classifyFreedom(false, [], ["Europe"])).toBe("unspecified")
  })

  test("one country is single-country", () => {
    expect(classifyFreedom(false, ["US"], ["North America"])).toBe("single-country")
  })

  test("two countries is multi-country", () => {
    expect(classifyFreedom(false, ["US", "CA"], ["North America"])).toBe("multi-country")
  })

  test("three or more countries is multi-region", () => {
    expect(classifyFreedom(false, ["US", "CA", "GB"], ["North America", "Europe"])).toBe("multi-region")
  })

  test("country count wins over continent count when both are known", () => {
    // US + Switzerland spans two continents but is still two countries; the
    // badge and the detail line must not disagree about that.
    expect(classifyFreedom(false, ["US", "CH"], ["North America", "Europe"])).toBe("multi-country")
  })
})

describe("Greenhouse location parsing", () => {
  test("US cities and state codes resolve to the US — the original bug", () => {
    for (const loc of [
      "San Francisco, CA",
      "Remote - New York",
      "Seattle, WA | Austin, TX",
      "Boston, MA; Washington, DC",
      "Remote, United States",
    ]) {
      expect(readGeography(loc).countries).toContain("US")
    }
  })

  test("a US-only posting is never graded worldwide", () => {
    const g = readGeography("Remote-Friendly (Travel-Required) | San Francisco, CA")
    expect(g.worldwideOk).toBe(false)
    expect(classifyFreedom(g.worldwideOk, g.countries, g.continents)).toBe("single-country")
  })

  test("bare 'anywhere' is not a worldwide claim", () => {
    // "Ukraine Anywhere" is a real Greenhouse location string and means
    // anywhere *in Ukraine*. The first build promoted it to the top tier.
    const ua = readGeography("Ukraine Anywhere")
    expect(ua.worldwideOk).toBe(false)
    expect(ua.countries).toEqual(["UA"])
    expect(readGeography("US - Anywhere").worldwideOk).toBe(false)
  })

  test("only an unambiguous whole-world phrase counts", () => {
    expect(readGeography("Remote - anywhere in the world").worldwideOk).toBe(true)
    expect(readGeography("Fully remote, worldwide").worldwideOk).toBe(true)
    expect(readGeography("Remote - Global").worldwideOk).toBe(true)
    expect(readGeography("Remote - anywhere in the US").worldwideOk).toBe(false)
  })

  test("region shorthands map to continents", () => {
    expect(readGeography("Remote - EMEA").continents).toContain("Europe")
    expect(readGeography("Remote (APAC)").continents).toContain("Asia")
  })

  test("multi-country postings collect every country named", () => {
    const g = readGeography("Remote - United Kingdom, Germany, Netherlands")
    expect(g.countries.sort()).toEqual(["DE", "GB", "NL"])
  })

  test("an unrecognised location yields nothing rather than a guess", () => {
    expect(readGeography("Distributed").countries).toEqual([])
    expect(readGeography("Distributed").worldwideOk).toBe(false)
  })
})

describe("looksRemote — office jobs with flexibility are not remote jobs", () => {
  test("rejects remote-friendly and travel-required postings", () => {
    expect(looksRemote("Remote-Friendly (Travel-Required) | San Francisco, CA", "Product Manager")).toBe(false)
  })

  test("rejects 'X or Remote', which means 'near X'", () => {
    expect(looksRemote("NYC or Remote", "Solutions Architect")).toBe(false)
  })

  test("rejects hybrid and onsite", () => {
    expect(looksRemote("Hybrid - London", "Engineer")).toBe(false)
    expect(looksRemote("Onsite, Austin TX", "Engineer")).toBe(false)
  })

  test("accepts plainly remote postings", () => {
    expect(looksRemote("Remote, United States", "Engineer")).toBe(true)
    expect(looksRemote("Remote - EMEA", "Engineer")).toBe(true)
  })
})

describe("HiringCafe mapping", () => {
  const hit = (v: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
    id: "gh___acme___1",
    apply_url: "https://job-boards.greenhouse.io/acme/jobs/1",
    source: "greenhouse",
    board_token: "acme",
    job_information: { title: "Staff Engineer" },
    v5_processed_job_data: { company_name: "Acme", workplace_type: "Remote", ...v },
    ...extra,
  })

  test("non-remote postings are dropped — this is a remote board", () => {
    expect(mapHit(hit({ workplace_type: "Hybrid" }), null)).toBeNull()
    expect(mapHit(hit({ workplace_type: "Onsite" }), null)).toBeNull()
  })

  test("expired postings are dropped", () => {
    expect(mapHit(hit({}, { is_expired: true }), null)).toBeNull()
  })

  test("country and continent lists drive the grade", () => {
    const job = mapHit(hit({ workplace_countries: ["US", "CA"], workplace_continents: ["North America"] }), null)!
    expect(job.freedom).toBe("multi-country")
  })

  test("an explicit worldwide flag is honoured", () => {
    const job = mapHit(hit({ is_workplace_worldwide_ok: true }), null)!
    expect(job.freedom).toBe("worldwide")
  })

  test("salary annualises so periods can be compared", () => {
    const hourly = mapHit(hit({ hourly_min_compensation: 50, hourly_max_compensation: 75 }), null)!
    expect(hourly.salary!.period).toBe("hr")
    expect(hourly.salary!.annualMax).toBe(75 * 2080)

    const yearly = mapHit(hit({ yearly_min_compensation: 150000 }), null)!
    expect(yearly.salary!.annualMin).toBe(150000)
  })

  test("the employer's apply URL is preferred over the aggregator page", () => {
    expect(mapHit(hit({}), "/job/staff-engineer-acme-ab12")!.applyUrl).toBe(
      "https://job-boards.greenhouse.io/acme/jobs/1",
    )
  })
})

describe("freedomDetail wording", () => {
  const base: Job = {
    id: "x", title: "t", company: "c", applyUrl: "u", source: "s", boardToken: null,
    postedAt: null, locationLabel: null, countries: [], continents: [], worldwideOk: false,
    freedom: "unspecified", category: null, seniority: null, commitment: null,
    salary: null, visaSponsorship: null, tools: [],
  }

  test("says plainly when the posting is silent", () => {
    expect(freedomDetail(base)).toBe("Posting does not say")
  })

  test("names the single country rather than implying breadth", () => {
    expect(freedomDetail({ ...base, countries: ["US"] })).toBe("US only")
  })

  test("counts and locates larger sets", () => {
    expect(freedomDetail({ ...base, countries: ["US", "CA", "GB"], continents: ["North America", "Europe"] }))
      .toBe("3 countries · North America, Europe")
  })
})

describe("compareJobs", () => {
  const j = (freedom: Job["freedom"], annualMax: number | null): Job => ({
    id: "x", title: "t", company: "c", applyUrl: "u", source: "s", boardToken: null,
    postedAt: null, locationLabel: null, countries: [], continents: [], worldwideOk: false,
    freedom, category: null, seniority: null, commitment: null,
    salary: annualMax === null ? null : { min: null, max: null, currency: "USD", period: "yr", annualMin: null, annualMax },
    visaSponsorship: null, tools: [],
  })

  test("freedom outranks pay", () => {
    expect(compareJobs(j("worldwide", 50000), j("single-country", 400000))).toBeLessThan(0)
  })

  test("within a tier, higher pay wins and unknown pay sorts last", () => {
    expect(compareJobs(j("worldwide", 200000), j("worldwide", 100000))).toBeLessThan(0)
    expect(compareJobs(j("worldwide", null), j("worldwide", 100000))).toBeGreaterThan(0)
  })

  test("unspecified sorts below every stated tier", () => {
    expect(TIER_RANK.unspecified).toBeGreaterThan(TIER_RANK["single-country"])
  })
})
