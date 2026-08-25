/* Hiring Island — client-side board over a static jobs.json. No dependencies. */

const TIER_LABEL = {
  worldwide: "Work from anywhere",
  "multi-region": "Multi-region",
  "multi-country": "Two countries",
  "single-country": "Single country",
  unspecified: "Location unstated",
};

const TIER_RANK = { worldwide: 0, "multi-region": 1, "multi-country": 2, "single-country": 3, unspecified: 4 };

const PAGE_SIZE = 50;

const el = (id) => document.getElementById(id);
const state = { jobs: [], filtered: [], shown: PAGE_SIZE };

/* ---------- formatting ---------- */

function freedomDetail(job) {
  if (job.worldwideOk) return "Anywhere in the world";
  if (!job.countries.length) return job.continents.length ? job.continents.join(", ") : "Posting does not say";
  if (job.countries.length === 1) return `${job.countries[0]} only`;
  if (job.countries.length === 2) return `${job.countries[0]} + ${job.countries[1]}`;
  const where = job.continents.length ? ` · ${job.continents.join(", ")}` : "";
  return `${job.countries.length} countries${where}`;
}

function money(n) {
  if (n === null || n === undefined) return null;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

function salaryLabel(s) {
  if (!s) return null;
  const lo = money(s.min);
  const hi = money(s.max);
  const range = lo && hi ? (lo === hi ? lo : `${lo}–${hi}`) : lo || hi;
  return `${s.currency} ${range}/${s.period}`;
}

function relativeDate(iso) {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  const days = Math.floor((Date.now() - then) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

/* ---------- rendering ---------- */

function jobCard(job) {
  const li = document.createElement("li");
  li.className = "job";

  const main = document.createElement("div");

  const h = document.createElement("h2");
  h.className = "job-title";
  const a = document.createElement("a");
  a.href = job.applyUrl;
  a.target = "_blank";
  a.rel = "noopener nofollow";
  a.textContent = job.title;
  h.append(a);

  const company = document.createElement("p");
  company.className = "job-company";
  company.textContent = job.company;
  if (job.locationLabel) company.textContent += ` · ${job.locationLabel}`;

  main.append(h, company);

  const tier = document.createElement("div");
  tier.className = "tier";
  const badge = document.createElement("span");
  badge.className = `tier-badge tier-${job.freedom}`;
  badge.textContent = TIER_LABEL[job.freedom] || job.freedom;
  const detail = document.createElement("span");
  detail.className = "tier-detail";
  detail.textContent = freedomDetail(job);
  tier.append(badge, detail);

  const posted = relativeDate(job.postedAt);
  if (posted) {
    const d = document.createElement("span");
    d.className = "job-date";
    d.textContent = `Posted ${posted}`;
    tier.append(d);
  }

  const tags = document.createElement("div");
  tags.className = "job-tags";

  const pay = salaryLabel(job.salary);
  if (pay) tags.append(tag(pay, "pay"));
  if (job.seniority) tags.append(tag(job.seniority));
  if (job.commitment) tags.append(tag(job.commitment));
  if (job.category) tags.append(tag(job.category));
  if (job.visaSponsorship === true) tags.append(tag("Sponsors visa", "visa"));
  for (const tool of job.tools.slice(0, 4)) tags.append(tag(tool));
  tags.append(tag(job.source));

  li.append(main, tier, tags);
  return li;
}

function tag(text, extra) {
  const s = document.createElement("span");
  s.className = extra ? `tag ${extra}` : "tag";
  s.textContent = text;
  return s;
}

function render() {
  const list = el("jobs");
  list.replaceChildren();

  if (state.filtered.length === 0) {
    const p = document.createElement("li");
    p.className = "empty";
    p.textContent = "No jobs match those filters. Try widening the freedom grade or clearing the search.";
    list.append(p);
    el("more").hidden = true;
    return;
  }

  const slice = state.filtered.slice(0, state.shown);
  const frag = document.createDocumentFragment();
  for (const job of slice) frag.append(jobCard(job));
  list.append(frag);

  el("more").hidden = state.shown >= state.filtered.length;
}

function updateCount() {
  const n = state.filtered.length;
  const total = state.jobs.length;
  const cross = state.filtered.filter((j) => j.freedom !== "single-country" && j.freedom !== "unspecified").length;
  el("count").innerHTML =
    `<strong>${n.toLocaleString()}</strong> of ${total.toLocaleString()} roles` +
    (cross ? ` · <strong>${cross}</strong> hire across borders` : "");
}

/* ---------- filtering ---------- */

function applyFilters() {
  const q = el("q").value.trim().toLowerCase();
  const terms = q ? q.split(/\s+/) : [];
  const minTier = el("tier").value;
  const seniority = el("seniority").value;
  const minPay = Number(el("pay").value);
  const paidOnly = el("paidOnly").checked;
  const visaOnly = el("visaOnly").checked;

  state.filtered = state.jobs.filter((job) => {
    if (minTier && TIER_RANK[job.freedom] > TIER_RANK[minTier]) return false;
    if (seniority && job.seniority !== seniority) return false;
    if (visaOnly && job.visaSponsorship !== true) return false;

    const top = job.salary ? job.salary.annualMax ?? job.salary.annualMin : null;
    if (paidOnly && top === null) return false;
    if (minPay > 0 && (top === null || top < minPay)) return false;

    if (terms.length) {
      const hay = `${job.title} ${job.company} ${job.category || ""} ${job.tools.join(" ")} ${job.locationLabel || ""}`.toLowerCase();
      if (!terms.every((t) => hay.includes(t))) return false;
    }
    return true;
  });

  const sort = el("sort").value;
  if (sort === "recent") {
    state.filtered.sort((a, b) => Date.parse(b.postedAt || 0) - Date.parse(a.postedAt || 0));
  } else if (sort === "pay") {
    const top = (j) => (j.salary ? j.salary.annualMax ?? j.salary.annualMin ?? -1 : -1);
    state.filtered.sort((a, b) => top(b) - top(a));
  }
  // "freedom" is the order the build already wrote, so no client sort needed.

  state.shown = PAGE_SIZE;
  updateCount();
  render();
}

/* ---------- boot ---------- */

function renderStats(meta) {
  const t = meta.tierCounts;
  // "Cross-border" is the stat that matters and the one no other board shows:
  // roles you can take without moving country. Leading with the worldwide
  // count alone would usually read as a broken page — it is often zero, which
  // is itself the finding.
  const crossBorder = (t.worldwide || 0) + (t["multi-region"] || 0) + (t["multi-country"] || 0);
  const share = meta.jobCount ? Math.round((crossBorder / meta.jobCount) * 100) : 0;
  const items = [
    ["Remote roles indexed", meta.jobCount.toLocaleString(), false],
    ["Cross-border", `${crossBorder.toLocaleString()} · ${share}%`, true],
    ["Single country only", (t["single-country"] || 0).toLocaleString(), false],
    ["Companies", meta.companyCount.toLocaleString(), false],
  ];
  const dl = el("stats");
  dl.replaceChildren();
  for (const [label, value, hi] of items) {
    const div = document.createElement("div");
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = value;
    if (hi) dd.className = "hi";
    div.append(dt, dd);
    dl.append(div);
  }

  const built = new Date(meta.generatedAt);
  el("footer-meta").textContent =
    `Last rebuilt ${built.toUTCString()} · ${meta.queries} role queries · ${meta.boards} Greenhouse boards.`;
}

function fillSeniority(jobs) {
  const order = ["Internship", "Entry Level", "Associate", "Mid Level", "Senior Level", "Staff", "Principal", "Director", "Executive"];
  const present = [...new Set(jobs.map((j) => j.seniority).filter(Boolean))];
  present.sort((a, b) => {
    const ia = order.indexOf(a), ib = order.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
  });
  const sel = el("seniority");
  for (const s of present) {
    const o = document.createElement("option");
    o.value = s;
    o.textContent = s;
    sel.append(o);
  }
}

async function boot() {
  try {
    const res = await fetch("data/jobs.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(`jobs.json -> ${res.status}`);
    const data = await res.json();

    state.jobs = data.jobs;
    renderStats(data.meta);
    fillSeniority(data.jobs);
    applyFilters();
  } catch (err) {
    el("count").textContent = "Could not load the job index. It may still be building — try again shortly.";
    console.error(err);
  }
}

el("controls").addEventListener("input", applyFilters);
el("sort").addEventListener("change", applyFilters);
el("more").addEventListener("click", () => {
  state.shown += PAGE_SIZE;
  render();
});
el("controls").addEventListener("submit", (e) => e.preventDefault());

boot();
