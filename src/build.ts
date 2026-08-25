#!/usr/bin/env bun
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import { dirname, join, resolve } from "path"
import { fileURLToPath } from "url"

import { compareJobs } from "./freedom.js"
import { harvest } from "./sources/hiringcafe.js"
import { harvestBoard, mapWithConcurrency } from "./sources/greenhouse.js"
import type { BuildMeta, FreedomTier, Job, SiteData } from "./types.js"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const SITE = join(ROOT, "site")

function readList(file: string): string[] {
  const path = join(ROOT, file)
  if (!existsSync(path)) return []
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((l) => l.replace(/#.*$/, "").trim())
    .filter(Boolean)
}

/**
 * Deduplicate across sources.
 *
 * The same requisition reaches us twice whenever HiringCafe has indexed a
 * Greenhouse board we also sweep directly. Company+title is the join key;
 * we keep whichever record carries more structured geography, because that
 * is what the site sorts on. HiringCafe usually wins that comparison — its
 * country list is a real field, where the Greenhouse one is inferred from a
 * free-text location.
 */
function dedupe(jobs: Job[]): Job[] {
  const byKey = new Map<string, Job>()
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()

  for (const job of jobs) {
    const key = `${norm(job.company)}|${norm(job.title)}`
    const existing = byKey.get(key)
    if (!existing) {
      byKey.set(key, job)
      continue
    }
    const score = (j: Job) =>
      (j.countries.length ? 4 : 0) + (j.salary ? 2 : 0) + (j.seniority ? 1 : 0) + (j.worldwideOk ? 1 : 0)
    if (score(job) > score(existing)) byKey.set(key, job)
  }
  return [...byKey.values()]
}

function tally<T extends string>(items: T[]): Record<T, number> {
  const out = {} as Record<T, number>
  for (const item of items) out[item] = (out[item] ?? 0) + 1
  return out
}

async function main(): Promise<number> {
  const queries = readList("queries.txt")
  const boards = readList("boards.txt")
  const pagesPerQuery = Number(process.env.PAGES_PER_QUERY ?? 3)

  if (queries.length === 0 && boards.length === 0) {
    console.error("nothing to build: both queries.txt and boards.txt are empty")
    return 1
  }

  console.log(`Hiring Island build`)
  console.log(`  ${queries.length} queries x ${pagesPerQuery} pages, ${boards.length} Greenhouse boards`)

  const collected: Job[] = []

  // HiringCafe: sequential across queries, paced inside harvest(). This is the
  // slow half, and deliberately so — it is a daily cron, not a crawl.
  for (const query of queries) {
    try {
      const found = await harvest(query, pagesPerQuery)
      collected.push(...found)
      console.log(`  hiringcafe  ${String(found.length).padStart(4)}  ${query}`)
    } catch (e) {
      console.warn(`  hiringcafe  FAIL  ${query}: ${e instanceof Error ? e.message : e}`)
    }
  }

  // Greenhouse: an official API, so a little more parallelism is fine.
  const boardResults = await mapWithConcurrency(boards, 4, async (board) => {
    try {
      const found = await harvestBoard(board)
      return { board, found, error: null as string | null }
    } catch (e) {
      return { board, found: [] as Job[], error: e instanceof Error ? e.message : String(e) }
    }
  })
  for (const r of boardResults) {
    if (r.error) console.warn(`  greenhouse  FAIL  ${r.board}: ${r.error}`)
    else if (r.found.length) console.log(`  greenhouse  ${String(r.found.length).padStart(4)}  ${r.board}`)
    collected.push(...r.found)
  }

  const jobs = dedupe(collected).sort(compareJobs)

  if (jobs.length === 0) {
    // Never overwrite a good site with an empty one: a transient upstream
    // failure would otherwise publish a blank board.
    console.error("no jobs collected - refusing to write an empty site")
    return 1
  }

  const meta: BuildMeta = {
    generatedAt: new Date().toISOString(),
    jobCount: jobs.length,
    companyCount: new Set(jobs.map((j) => j.company.toLowerCase())).size,
    // Zero-fill first so a tier with no jobs still reports 0 rather than
    // vanishing from the site's summary.
    tierCounts: Object.assign(
      { worldwide: 0, "multi-region": 0, "multi-country": 0, "single-country": 0, unspecified: 0 },
      tally(jobs.map((j) => j.freedom as FreedomTier)),
    ),
    sources: tally(jobs.map((j) => j.source)),
    queries: queries.length,
    boards: boards.length,
  }

  const data: SiteData = { meta, jobs }
  mkdirSync(join(SITE, "data"), { recursive: true })
  writeFileSync(join(SITE, "data", "jobs.json"), JSON.stringify(data), "utf8")

  console.log("")
  console.log(`  ${meta.jobCount} jobs from ${meta.companyCount} companies`)
  console.log(`  worldwide ${meta.tierCounts.worldwide} | multi-region ${meta.tierCounts["multi-region"]} | two-country ${meta.tierCounts["multi-country"]} | single ${meta.tierCounts["single-country"]} | unstated ${meta.tierCounts.unspecified}`)
  console.log(`  -> site/data/jobs.json`)
  return 0
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(e instanceof Error ? e.stack : String(e))
    process.exit(1)
  })
