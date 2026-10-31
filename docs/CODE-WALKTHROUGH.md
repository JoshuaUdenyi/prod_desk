# ProductionDesk — the code, explained plainly

This is a tour of the whole codebase in language that assumes you can read a bit of JavaScript but have never built a full-stack app. No jargon left unexplained.

---

## 1. What the app actually is

A production company in Abuja does live streaming for events — corporate gigs, concerts, church services, weddings. Each job needs cameras, crew, transport, internet, and so on. The tricky part of that business is that it's very easy to quote a price that looks fine and then discover afterwards that you lost money.

ProductionDesk does one job: it makes you add up what a job will cost **before** you quote it, helps you pick a price that leaves a real profit, prints a clean quotation for the client, and then after the event lets you enter what you *actually* spent so you can see whether the job made or lost money.

The single sentence that drives every design decision: **cost every job before quoting it, track what was actually spent, know the real profit after delivery.**

---

## 2. The shape of the thing

There are two programs in this folder that talk to each other over HTTP.

The **frontend** is a React app — the thing a human clicks on. It lives in `src/client/`. React is just "build the page out of reusable little functions (components) that redraw when data changes."

The **backend** is a Cloudflare Worker — a program that runs on Cloudflare's servers, answers requests that start with `/api/`, and reads/writes a database. It lives in `src/worker/`.

When you build the app, the frontend gets compiled into plain files (`dist/client`) and Cloudflare serves them from its CDN. Requests to `/api/...` go to the Worker code; every other URL just gets the frontend files, and the frontend's router figures out which page to show. That's what this bit of `wrangler.jsonc` means:

```jsonc
"assets": {
  "directory": "./dist/client",
  "not_found_handling": "single-page-application",
  "run_worker_first": ["/api/*"]
}
```

"Single-page application" is a slightly misleading name. It means: the server always hands back the same HTML file, and JavaScript in the browser decides what to draw. So `/projects/abc123` isn't a real file on a server — it's just the app noticing the URL and rendering the project page.

The database is **Cloudflare D1**, which is SQLite with a Cloudflare wrapper. It's a single file with tables, queried with SQL. The file storage is **Cloudflare R2**, which is like a bucket where you dump files (logos, generated PDFs).

---

## 3. The most important idea in the repo: money is never a decimal

This is the bit that separates a toy from something a business can trust, so it gets its own section.

If you write `0.1 + 0.2` in JavaScript you get `0.30000000000000004`. Computers store decimals in binary, and most decimals can't be represented exactly. Do that a few hundred times across a costing sheet and your totals drift by kobo, and eventually someone notices that the invoice is off by ₦3 and stops trusting the app.

So the code never stores money as a decimal. Three conventions run through everything:

**Money is an integer number of kobo.** One naira is 100 kobo. ₦1,350.50 is stored as `135050`. No decimal point anywhere, so no rounding error.

**Quantities and days are integers scaled by 1,000.** So "1.5 rental days" is stored as `1500`. Same trick, different scale.

**Percentages are basis points.** One percent is 100 basis points. So 30% is `3000`, and 7.5% VAT is `750`. Again: integers only.

And here's the naming rule that makes the code readable once you know it: **if a variable name doesn't end in `Kobo`, `Milli`, or `Bp`, it isn't money, quantity, or a percentage.** `sellingPriceNetKobo`, `quantityMilli`, `vatRateBp`. Once you internalise that, the whole codebase reads differently.

`src/worker/domain/money.ts` is where the actual arithmetic lives. Two functions matter:

`parseScaled` takes what a human typed — `"₦1,350.50"`, `"(20,000)"` for negative, `"7.5%"` — and turns it into an exact integer. It does the digit-shifting by hand rather than using `parseFloat`, so nothing is lost.

`roundDivide` is the only place in the entire codebase that rounds. It multiplies everything out in `BigInt` (JavaScript's arbitrary-precision integer type — it can hold a number of any size exactly), divides once, and rounds halves away from zero. The comment in the file is worth reading: everything else composes this one function, so there is exactly one rounding decision to reason about. That's deliberate.

`multiplyScaled(rateKobo, quantityMilli, daysMilli)` is the workhorse. It multiplies rate × quantity × days as `BigInt`, then divides by 1,000,000 (because quantity and days each carry three decimal places) and rounds. `percentOf(amountKobo, basisPoints)` does the same for percentages.

Notice the file documents a maximum: around ₦90 trillion. Above that it throws rather than silently losing precision, because eventually the number would stop being exactly representable when handed back to normal JavaScript numbers.

---

## 4. The pricing engine

`src/worker/domain/pricing.ts` is the brain. Every number a user sees on screen is calculated here, on the server. The client never does authoritative maths — it displays what the server sent back. That's a privacy and correctness decision: if the browser calculated margins, a curious user could just edit the JavaScript in devtools.

### 4.1 Adding up a line item

Each line of a cost sheet is one of three kinds, because the PRD defines three different formulas:

An **equipment** line is `quantity × rental rate × rental days + additional charges`. So two cameras at ₦50,000 a day for three days, plus a ₦20,000 delivery fee, is ₦320,000.

A **crew** line is `people × rate per person × days + allowances/overtime`. Four crew at ₦25,000 for two days, plus ₦30,000 overtime, is ₦230,000.

A **standard** line (logistics, internet, "other") is just `quantity × unit rate`.

`lineTotalKobo` implements exactly that, and `test/pricing.test.ts` checks each formula against those worked examples.

### 4.2 Building a cost breakdown

`computeCostBreakdown` walks the lines and produces category totals, then layers on the extras in a specific order:

**Direct subtotal** — everything in equipment, crew, logistics, internet, and other. Overhead is deliberately excluded here, because overhead isn't a direct cost of this job.

**Overhead** — two sources, added together and never double-counted. You can type manual overhead lines, *and* the app can allocate overhead automatically either as a fixed naira amount per project or as a percentage of direct costs. `manualOverheadKobo + allocatedOverheadKobo = overheadKobo`.

**Contingency** — the "something will go wrong" buffer. There's exactly one source of it: the configured percentage. The code explicitly refuses to support manual contingency lines so the buffer can't be counted twice. You can choose whether it applies to direct costs alone or direct costs plus overhead, and the chosen base is always reported back so the screen can show it.

**Direct costs for margin purposes** = direct subtotal + contingency.

That last one is the number that gross profit is measured against, and it's a judgement call worth understanding: the contingency is treated as a real expected cost, so a price only counts as hitting its margin if it clears the buffer too.

### 4.3 The target-margin price

The formula is the one the PRD gives: **recommended price = cost base ÷ (1 − target margin)**.

Why divide instead of multiply? Because margin is defined against the *selling* price, not the cost. If you need 30% of the price to be profit, then 70% of the price is cost, so price = cost ÷ 0.7. If you had instead done cost × 1.3, you'd get a 23% margin and feel cheated.

`recommendedPriceKobo` implements exactly that in `BigInt`, and rejects two impossible cases instead of producing garbage: a negative margin, and 100% or more (which would divide by zero or by a negative). If the cost base is zero it returns zero.

The test suite pins the PRD's own worked example: ₦400,000 at 30% gives ₦571,428.57, which the PRD rounds to ₦571,429.

### 4.4 Which costs the price is built on

You can choose the "price base" — what the recommended price is calculated from. Three options, each with a label the UI displays: direct costs only, direct plus contingency (the default), or direct plus contingency plus overhead.

If you pick the third, the engine adds a warning, because including overhead in the base means the resulting "gross margin" flatters you: the price now also covers operating costs, so the margin on direct project costs alone is higher than it looks. The code refuses to let that pass silently.

### 4.5 Turning a price into a profit

`computeProfit` produces the three profit measures the PRD insists on keeping separate:

| Measure | Calculation |
| --- | --- |
| Gross profit | net revenue − direct costs |
| Operating profit | gross profit − overhead − other operating expenses |
| Estimated net profit | operating profit − tax provision |

Net revenue means the selling price **excluding VAT**. VAT is never revenue. The client pays the price plus VAT; the VAT belongs to the government; if you counted it as income your margin would look better than it is. So VAT is calculated separately and stored separately, and `totalPayableKobo = netRevenue + VAT`.

One nice detail: the tax provision only applies to *positive* operating profit. If the job lost money, the provision is zero rather than a negative tax credit, because you can't provision tax against a loss.

### 4.6 Margin bands and the approval gate

Margins get a colour-and-word label: below 15% is critical, 15–24.99% low, 25–34.99% acceptable, 35–40% good, above 40% excellent. Every threshold is configurable by the owner, and `validateThresholds` refuses to save a set that isn't in increasing order, which would make the band function nonsense.

Separately, there's a **minimum margin**. Price below it and the project's approval status flips to "required", and only an owner can clear it — by recording a written reason. That reason, the margin at the time, and the minimum get written to the audit log. Changing the price afterwards invalidates the old sign-off: the SQL resets `approved_by`, `approved_at`, and `approval_reason` back to null whenever approval is needed again. The code handles that inside a single `UPDATE` with `CASE WHEN`, so there's no window where a stale approval is trusted.

### 4.7 Budget versus actual

After the event, real expenses get entered. `compareBudgetToActual` lines them up per category against the estimate and reports variance, where positive means over budget. `evaluateActuals` then recomputes profit using real costs.

There's one rule worth knowing: **contingency does not appear in the actual figures.** It was a budget allowance, a guess about what might go wrong. Once you know what actually happened, the guess is irrelevant.

---

## 5. The database

`migrations/0001_init.sql` is the whole schema, and it's readable as a document.

`users` and `sessions` handle login. `settings` is a single row (enforced by `CHECK (id = 1)`) holding company details, default margins, thresholds, contingency and overhead defaults, VAT and tax settings, and quotation defaults.

`projects` holds one row per job. Two things about it are deliberate and important. First, it snapshots the pricing assumptions — `contingency_bp`, `overhead_method`, and friends are copied onto the project when it's created. So if the company changes its default contingency next year, old projects keep the numbers they were quoted with. Second, it stores `selling_price_net_kobo` and `vat_kobo` separately, and keeps `quote_locked_at` so you can tell that a real quotation was issued against this price.

`cost_lines` is the estimate. `actual_expenses` is what really happened. They're separate tables on purpose: the PRD says estimates are never overwritten by actuals, and a separate table is the simplest way to guarantee that.

`quotations` stores a **client-facing snapshot** in `client_items_json`. It contains only what a client is allowed to see — descriptions, quantities, prices. No supplier rates, no cost lines, no margins. Once issued, the JSON is frozen, so a quotation sent last month still reproduces exactly.

`payments` tracks money received. `audit_log` is append-only and records who did what.

The conventions at the top of the file are worth committing to memory: ISO 8601 UTC timestamps, money as INTEGER kobo, quantities as INTEGER milli, percentages as INTEGER basis points. There is not a single `REAL` column in the schema, which is the database-level version of the "no floats for money" rule.

---

## 6. Logging in

`src/worker/auth/password.ts` hashes passwords with PBKDF2-SHA256 using WebCrypto, which is built into the Workers runtime — no npm dependency, no native module that won't compile. 210,000 iterations, a random 16-byte salt per user, and the iteration count stored per user so it can be raised later without invalidating everyone's existing password.

Two details that show care. `constantTimeEqual` compares hashes byte by byte without early exit, so the time it takes can't leak how much of a guess was right. And the login route verifies a password against a dummy record even when no user exists, so a failed login for a real email and a made-up email take the same amount of time — otherwise you could use login timing to discover which emails have accounts.

Sessions are opaque random tokens, not JWTs. A 256-bit random string goes into an HttpOnly cookie; the database stores only its SHA-256 hash. That means a database leak doesn't hand anyone usable sessions. `httpOnly` means JavaScript can't read the cookie, which mostly defuses XSS-based session theft. The cookie is `secure` in production and `sameSite: 'Lax'`, which is the reasonable default for a normal web app.

There are two roles: `owner` and `finance`. `requireAuth` checks you're signed in; `requireOwner` checks you're the owner. Owner-only actions are settings, approving a below-minimum price, deleting projects, deleting issued-but-draft quotations, and managing users. Everything else is available to any signed-in user.

First run is handled by `/api/auth/setup`, which only works while the `users` table is empty. That's the bootstrapping problem every app has — how does the first admin exist? — solved by making the first person to arrive the owner, once.

---

## 7. The API

`src/worker/index.ts` is the entry point: it mounts route groups under `/api/auth`, `/api/dashboard`, `/api/projects`, `/api/quotations`, `/api/settings`, `/api/files`, `/api/audit`.

The framework is **Hono**, which is to Cloudflare Workers what Express is to Node. It's tiny and fast.

Everything is validated with **Zod** before it touches the database. `readBody` parses the JSON and runs the schema; if anything's wrong it throws a 400 carrying per-field messages, which the frontend uses to highlight the exact input box that's broken. That's a nice user-experience detail that's easy to miss when reading routes.

There's a subtle thing in `routes/projects.ts` worth pointing out, because it's the kind of bug that's invisible until it bites. The update schema spells out every field as `.optional()` instead of using `.partial()` on the create schema. The comment explains why: Zod's `.partial()` doesn't strip an inner `.default()`, so a PATCH carrying one field would silently reset every other field to its default. The git history shows this was a real bug that got fixed (`Stop PATCH endpoints resetting fields to their schema defaults`).

The other pattern you'll see everywhere: **mutations return the whole project detail.** Add a cost line, and the response is the entire updated project — lines, financials, actuals, payments, quotations. It's a bit chatty, but it means the client can't drift out of sync, and there's no separate "now refetch everything" step.

---

## 8. The quotation trick

This is the cleverest part of the app and it's easy to skim past.

The client must see itemised prices — "Camera package, 3 days, ₦X per day" — but must never see what those things cost you. So how do you itemise a price without leaking your costs?

`buildClientItems` in `routes/quotations.ts` does it: it takes the project's **net selling price** (the single number you decided to charge) and distributes it across the client-facing lines in proportion to each line's internal cost. So a line that represents 40% of your cost becomes roughly 40% of the client's price, and the total lands exactly on the selling price. `allocateKobo` handles the rounding drift by dumping the leftover kobo on the largest line, so the parts always add up to the whole.

The result is itemisation that looks completely natural to the client and reveals nothing about your margins, because the prices are derived from the total, not from the costs.

The "package" layout skips all of that and shows a single line for the whole job at the full price.

`pdf/quotation.ts` renders it with **pdf-lib**, a pure-JavaScript PDF library that works in Workers (no headless browser needed). One constraint shaped the design: pdf-lib's built-in fonts use WinAnsi encoding, which has no ₦ symbol. Rather than bundling a megabyte of Unicode font into the worker, amounts print as `NGN 1,350,000.00`. The `safeText` function also strips curly quotes and em-dashes, which would otherwise render as garbage characters.

The PDF is generated on demand, stored in R2, and streamed back as `inline` so it opens in the browser rather than downloading.

---

## 9. The frontend

`src/client/` is a normal React 19 app with React Router. `main.tsx` mounts it and wraps everything in three providers: a router, a session provider, and a toast provider.

`App.tsx` is the gate: while the session is loading it shows a spinner, if there's no user it shows `LoginPage`, and otherwise it renders the app shell plus routes for the dashboard, project list, single project, and settings.

`lib/api.ts` is the only file that touches the network. Every call goes through one `request` function that adds the JSON content type, sends cookies, parses the response, and turns a failure into an `ApiError` carrying the server's per-field messages. That's why pages can do `setFields(error.fields)` and immediately highlight the offending input.

`lib/session.tsx` keeps the signed-in user in React state. It never stores a token — the cookie is HttpOnly, so the client literally can't read it. On boot it asks `/api/auth/me` once; a 401 there just means "not signed in", not an error.

`lib/parse.ts` and `lib/format.ts` are the two directions of the same translation: text the user types → storage units, and storage units → text on screen. `1,350.50` becomes `135050` going in; `135050` becomes `₦1,350.50` coming out.

`components/ui.tsx` is a small hand-rolled design system: Button, Card, StatCard, Pill, StatusPill, BandPill, Field, Input, Select, Checkbox, Tabs, ProgressBar, EmptyState, Spinner, Skeleton, Drawer, and the toast system. There's no component library — it's about 500 lines of Tailwind classes, which keeps the bundle small and the look consistent.

`components/shell.tsx` is the persistent left navigation rail, which collapses behind a hamburger on mobile.

`components/charts.tsx` draws the dashboard trend line and donut by generating raw SVG paths — the `smoothPath` function builds a smooth curve through the data points. No charting library at all.

`styles.css` defines the design tokens. The comments say the visual reference was the Marvilo accounting kit, and the direction is dark: near-black canvas, a slightly lighter card, one violet accent, and green/amber/red for status. Every status also carries a word or icon, not just a colour, which matters for colour-blind users and was a PRD requirement.

`pages/ProjectPage.tsx` is the biggest file at ~1,300 lines, and it's the heart of the UI: a persistent financial summary panel on the right (sticky on desktop, per the PRD) and four tabs on the left — cost lines, quotations, actuals, payments. Every action returns fresh detail from the server and swaps it into state, so the summary panel updates as soon as anything changes.

---

## 10. Following one click all the way through

Say you're on a project page and you add a camera line.

React opens a drawer, you type "Sony FX6", quantity 2, rate 50,000, days 3. `parse.ts` turns those into `quantityMilli: 2000`, `unitRateKobo: 5000000`, `daysMilli: 3000`.

`api.projects.addCostLine` POSTs that to `/api/projects/<id>/cost-lines`.

Hono's `requireAuth` middleware reads the `pd_session` cookie, hashes it, looks it up in `sessions`, joins to `users`, and attaches the user to the request context. No session, no entry.

`readBody` validates the payload against `costLineSchema`. `inferKind` notices the category is `equipment` and sets the line kind, which is what makes the quantity × rate × days formula apply.

A row goes into `cost_lines`. An audit entry goes into `audit_log`. Then `loadProjectDetail` reloads everything, calls `evaluate`, and returns the whole project.

`evaluate` → `evaluateProject` → `computeCostBreakdown` → `lineTotalKobo` → `multiplyScaled` → `BigInt` arithmetic → one rounded kobo value. Then the recommended price, the gross profit, the operating profit, the tax provision, the VAT, and the margin band all fall out of that.

Back in the browser, `setDetail(response)` re-renders. The summary panel shows the new direct costs, the new recommended price, and the new margin. Total round trip: a few milliseconds, and the number in the database and the number on screen were produced by the same code path.

That's the whole architecture in one example. Everything else is the same pattern with different tables.

---

## 11. Tests

`test/money.test.ts` checks parsing, rounding, scaled multiplication, ratios, and formatting — including that junk input throws instead of silently becoming zero.

`test/pricing.test.ts` is the important one. It reproduces the PRD's worked examples (the ₦600,000 cost base, the ₦400,000 → ₦571,429 price, the variance table), checks that gross/operating/net stay separate, that VAT never counts as revenue, that a loss gets no tax provision, that margin band boundaries land on the right side, and that overhead and contingency are never double-counted.

The tests run on the pure functions with no database and no HTTP, which is why they're fast and why the business rules are trustworthy. When someone asks "is the maths right?", you point at this file.

Commands: `npm test`, `npm run typecheck`, `npm run dev` (runs the API on 8787 and Vite on 5173, with Vite proxying `/api` to the Worker).

---

## 12. Things worth knowing before you change anything

The browser's `parse.ts` uses ordinary `Number()` and `Math.round`, while the server's `money.ts` does exact decimal parsing. For anything a human types they agree, and the server is the authority anyway — but if you ever pass exotic values through, the client's preview and the server's stored value could differ by a kobo.

A stored selling price of `0` means "not overridden", so `evaluate` treats it as "use the recommended price". That's intentional and it's what makes new projects price themselves correctly — just don't use `0` to mean "I'm giving this away free", because it will be read as "no decision yet".

The actuals view will show a project's full selling price as "actual net profit" until you enter at least one real expense, because zero recorded expenses means zero actual costs. The dashboard guards against this (it only counts actuals for projects that have some), but the project page doesn't. Not a bug exactly, but it will look alarming on a fresh project.

`nextProjectReference` builds `PD-2026-0042` by reading the highest existing reference and adding one. Two people creating a project in the same instant could collide. The `UNIQUE` constraint would reject the second one, so you'd get an error rather than corrupt data — but it's a rough edge.

`projectRoutes.patch('/:id')` lets any signed-in user set a project's status directly, including to `completed`. Only approvals, settings, user management, and deletions are owner-gated. That matches the PRD's "one admin and a small number of trusted users" stance, but it's the kind of permission you'd tighten if the team grew.

The dashboard recomputes every project's financials in JavaScript on every load rather than storing totals in the database. For a company with a few hundred projects that's completely fine and it means there's exactly one source of truth for the maths. At tens of thousands of projects you'd want to cache or precompute — but not before then.
