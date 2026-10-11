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

Each anchor is a judgement about what "doing well" means. Where a published benchmark exists it is used; where none
does, the anchor is derived from the distribution of US places and labelled as a choice. Every one carries its
reasoning in `shared/indicators.js`, shown in the panel when you hover a line.

| Indicator | Floor (0) | Target (100) | Where it comes from |
|---|---|---|---|
| Rent-burdened renters | 75% | 35% | HUD's 30% cost-burden line; Chapel Hill is at 60.8%, NC 48.9%, US 51.1% |
| Price to income | 10 | 4 | NC and US both sit at about 4; 10 is the most expensive US metros |
| New homes a year | 0 | 485 | The Town's own target pace (Complete Community Strategy, 2022) |
| Households priced out | 1,000 | 0 | 1,000 is about 5% of the town's households over a decade |
| Jobs | −5% | +15% | LEHD's +1.3%/yr since 2002 compounds to about +14% a decade |
| Storefront businesses | −15% | +15% | Mirrors jobs; storefronts follow local spending |
| Storefront vacancy | 35% | 5% | Triangle retail runs 2.9%; Chapel Hill's downtown is at about 24% |
| Real median income | −5% | +20% | Falling real income is the clearest sign of a place getting poorer |
| Town budget | flat in cash | +26% | Ten years of 2.3% inflation: the Town's money has to keep pace with prices |
| Average commute | 30 min | 15 min | US metro average is 26.4; Chapel Hill is at 19.5 |
| Access to jobs | −10% | +20% | Derived: a fifth more jobs within a normal commute is a real gain |
| Bus ridership | −20% | +30% | Derived, for a fare-free system people either take up or give up on |
| Car traffic | +25% | −5% | Derived from the congestion residents actually complain about |
| Tree cover | 30% | 50% | Chapel Hill starts at 46.9%; 30% is a built-out suburb |
| Commute CO₂ | +20% | −20% | The Town's Climate Action and Response Plan wants transport emissions cut |
| Commuters driving | 92% | 65% | US average is 91.1%; Chapel Hill is at 73.8% |
| Tax burden | 5% of income | 2.5% | A normal US property tax bill against one households feel |

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
