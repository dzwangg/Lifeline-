# The city health score

At the end of a decade the game answers one question: **is Chapel Hill better off than if the Town had done nothing?**
It answers with a number out of 100, split into two halves — the economy, and the people who live here — and it always
shows the same number for a town that adopted no new policy, because a score on its own can't tell you whether a policy
helped or the town was heading there anyway.

The scoring lives in [`shared/health.js`](../shared/health.js); the anchors live next to each indicator in
[`shared/indicators.js`](../shared/indicators.js). Why each indicator is in the panel at all is
[`indicators.md`](indicators.md); this file is about turning them into a score.

## The problem

Twenty-one numbers move over ten years. Some go up when things get better (jobs, homes, income), some go down
(rent burden, commute, carbon). They're in different units — dollars, minutes, percentages, tonnes. "The city is doing
well" has to mean something specific before it can be a number, and the number has to be comparable between a run with
policies and a run without.

## The solution, in four steps

### 1. Each indicator is read in the basis that suits it

| Basis | What it reads | Used for |
|---|---|---|
| `level` | the value this year | rent burden, commute, tree cover, vacancy, tax burden — things with a meaningful absolute level |
| `ratioToStart` | this year ÷ year 0 | jobs, businesses, real income, bus trips, commute CO₂, the Town's budget — things that only mean something as growth |
| `perYear` | (this year − year 0) ÷ years | new homes a year, so a longer game isn't automatically a better score |

### 2. Two anchors turn it into 0–100

Every scored indicator carries a **target** (scores 100) and a **floor** (scores 0), with a straight line between and
clamping at both ends. The direction falls out of the anchors: for rent burden the target (35%) sits *below* the floor
(75%); for jobs it sits above. No separate "higher is better" flag is needed in the arithmetic.

A growth anchor is written per decade and compounded to the year being scored: +15% of jobs over ten years asks for
+1.4% after one. Without that every growth indicator would sit at its floor early in a run and the score would climb on
the calendar rather than on the policies. **Year 0 is not scored at all** — nothing has grown yet and both runs are the
same town.

### 3. Two halves, then the midpoint

Each half is the weighted mean of its own indicators. Overall is the mean of the two halves, so the side with more
indicators can't drown out the other.

**Economy — is the town earning its living?** New homes a year, jobs, storefront businesses, storefront vacancy, real
median household income, the Town's budget.

**Residents — are the people here better off?** Rent burden (weight 2), price to income, households priced out
(weight 1.5), commute, access to jobs, bus ridership (0.5), car traffic (0.5), tree cover, commute CO₂ (0.75),
commuters driving (0.75), property tax burden.

The weights are the one place a value judgement is deliberately loud. Rent burden counts double because it is the
clearest measure of whether living here is affordable; displacement counts 1.5 because being forced out is the sharpest
harm the model can show. Bus ridership, traffic, CO₂ and car share are weighted below 1 because they overlap — four
measures of the same transport story shouldn't outvote housing. Housing and staying put together are about 41% of the
residents' half, getting around 27%, environment 23%, tax 9%.

### 4. The same scoring runs on the no-policy town

The headline is the scenario's score; underneath it is the same decade with no new policy. On today's path Chapel Hill
scores about **58** — "holding steady" — and it is roughly flat across the decade, which is the point: the baseline is
not 50 by construction, it is what the models say happens if the Council does nothing.

## The anchors

Each anchor is a judgement about what "doing well" means, so each one carries its reasoning in
`shared/indicators.js`, shown in the panel when you hover a line. Where a published benchmark exists it is used; the
rest are marked **our choice** and derived from the spread of US places.

The pattern follows the **SDG Index**: goalposts chosen by preference order — the Town's own adopted goal, then a
recognized standard, then the spread of real US places — with hard censoring at both ends. Fixed goalposts (as the UN's
Human Development Index uses) rather than percentile ranking (as the AARP Livability Index uses) is a deliberate
choice: a percentile score is re-based every time the reference set moves, so a town can improve and score lower, and
in practice it compresses into a narrow band — AARP's own city scores only ever run from about 23 to 73. A player's
decade has to be legible against the one before it, so the goalposts stay still.

| Indicator | Floor (0) | Target (100) | Where it comes from |
|---|---|---|---|
| Rent-burdened renters | 70% | 35% | Target: lowest state in the US. Floor: worst large metro is Miami at 63%, and places spread wider than metros (Harvard JCHS, *America's Rental Housing 2026*) |
| Price to income | 9.0 | 3.0 | Demographia's published bands: ≤3.0 "affordable", ≥9.0 "impossibly unaffordable" |
| New homes a year | 104 | 485 | Target: the Town's own pace (Complete Community Strategy, 2022). Floor: the 2009 national trough, 4.4 per 1,000 homes (Census Building Permits Survey) |
| Households priced out | 1,000 | 0 | **Our choice** — about 5% of the town. No published municipal rate exists; this counts only households the model drives out, not ordinary moving |
| Jobs | −1.0%/yr | +2.0%/yr | Target: the long-run US rate (BLS, 100 years of CES). Floor: within the range of shrinking large counties (BLS QCEW) |
| Storefront businesses | −15% | +15% | **Our choice**, mirroring jobs; storefronts follow local spending |
| Storefront vacancy | 30% | 5% | Target: the natural retail vacancy rate (San Francisco Fed). Floor: past the Chicago Loop's 28.5%, the worst big-city downtown |
| Real median income | −5% | +20% | The best and worst decades in the US series (FRED real median household income). The median US decade, +8.1%, scores 52 |
| Town budget | flat in cash | +26% | Ten years of 2.3% inflation: the Town's money has to keep pace with prices |
| Average commute | 40 min | 15 min | Target: where peer college towns sit. Floor: approaching the worst US county (the Bronx, 43.9) and past the hour a day people have long put up with (Marchetti) |
| Access to jobs | −10% | +20% | **Our choice**: a fifth more jobs within a normal commute is a real gain |
| Bus ridership | −20% | +30% | **Our choice**, read as growth: Chapel Hill already carries 48 trips per resident of its service area, about eighth of 314 small US systems, so a level score has no headroom |
| Car traffic | +25% | −5% | **Our choice**, from the congestion residents complain about |
| Tree cover | 15% | 55% | Floor: just above the least-wooded state (North Dakota, 10.1%; US urban average 39.4% — Nowak & Greenfield 2018). Target: within American Forests' 40–60% range for forested regions |
| Commute CO₂ | +20% | −20% | **Our choice**, in the direction the Town's Climate Action and Response Plan and science-based municipal targets point. No agency publishes a commuting-only per-head benchmark |
| Commuters driving | 96% | 65% | Target: the Town's **own adopted goal** of a 35% bike, walk and transit share (Mobility and Connectivity Plan). Floor: the most car-dependent states on the same basis |
| Tax burden | 9% of income | 2.0% | The spread across US states (ACS 2024, median tax paid ÷ median income): 2.0% is the 10th percentile, 9.0% is New Jersey, worst in the country |

Three measurement choices worth knowing, because each one moves its score by a lot:

- **The tax bill is the whole bill, against owners' income.** A Chapel Hill homeowner pays 132.84¢ per $100 — the Town's
  50.0¢ plus Orange County's 68.05¢ and the school district's 14.79¢ — and property tax is a bill owners pay, so the
  denominator is owner households' income, not everyone's. Divide the same bill by *all* households' income and Chapel
  Hill reads as the worst-taxed place in America for reasons that have nothing to do with tax policy. The flip side is
  that the player only moves about a third of this number.
- **Rent burden counts students.** Part of Chapel Hill's 60.8% is students with little recorded income, so the town
  reads worse here than it lives.
- **Driving excludes people who work from home**, on both the town's value and the anchors.

## What it deliberately does not do

- **It does not fake healthcare, schools or crime.** The models don't simulate them, so the score doesn't pretend to.
  An earlier draft had a police/crime lever and it was cut; adding a number the model can't move would make the score
  look more complete than it is.
- **It does not score context numbers.** Median rent, median home value, households, affordable homes added and tax
  revenue stay in the panel but out of the score: a rising home value is good for owners and bad for first buyers, and
  rent is already measured against income by rent burden.
- **It is not a forecast.** It scores one central run. CH-LUTI's 200-run range is still shown per indicator; the score
  is a reading of the middle of it.

## Tuning it

Change the numbers in the `score` block next to an indicator in `shared/indicators.js` — category, basis, anchors,
weight — and the panel, the final screen and the tests all follow. `tests/health.test.js` holds the contract: every
scored indicator is a real metric, the anchors point the way its direction says, the halves are weighted means, the
baseline lands mid-scale, and building homes, releasing the edge of town, cutting tax and running more buses each move
the score the way the models say they should.
