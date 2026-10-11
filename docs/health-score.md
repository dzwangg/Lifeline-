# The city health score

At the end of a decade the game answers one question: **is Chapel Hill better off than if the Town had done nothing?**
It answers with a number out of 100, split into two halves — the economy, and the people who live here — where
**50 is the town that adopted nothing**. Above 50 the policies left it better off, below 50 worse.

The scoring lives in [`shared/health.js`](../shared/health.js); the anchors live next to each indicator in
[`shared/indicators.js`](../shared/indicators.js). Why each indicator is in the panel at all is
[`indicators.md`](indicators.md); this file is about turning them into a score.

## The problem

Twenty-two numbers move over a decade. Some go up when things get better (jobs, homes, income), some go down (rent
burden, commute, carbon), and they are in different units — dollars, minutes, percentages, tonnes. Worse, most of them
barely move in ten years no matter what the Council does: scored in absolute terms, the number would mostly measure
Chapel Hill's starting position and sit near the same value whatever the player did.

## The solution, in four steps

### 1. Fifty is the town that did nothing

Every indicator is scored against **the same decade run with no new policy**, so a run compared with itself is 50 on
the nose, on every indicator and both halves. The number then always answers one question: better or worse than doing
nothing? The no-policy run is computed anyway — the panel has always compared against it — so this costs nothing and
makes the score about the policies rather than about Chapel Hill's inheritance.

### 2. Each indicator is read in the basis that suits it

| Basis | What it reads | Used for |
|---|---|---|
| `level` | the value this year | rent burden, commute, tree cover, vacancy, tax burden |
| `ratioToStart` | this year ÷ year 0 | jobs, businesses, real income, bus trips, commute CO₂, the Town's budget |
| `perYear` | (this year − year 0) ÷ years | new homes a year, so a longer game isn't automatically a better score |

**Year 0 is not scored** — nothing has grown yet and both runs are the same town.

### 3. A swing turns the gap into a score

The gap between the two runs is divided by that indicator's **swing**: the move against doing nothing that counts as
decisive. A full swing better is 100, a full swing worse is 0, no change is 50, and the result is clamped so one
runaway indicator can't carry the score on its own.

The swings are calibrated against what the models actually do — measured across upzoning, a subsidy, maximum edge
release, an eight-cent tax move and a bus doubling, then set near the largest effect a single determined policy
produces. That is what makes the score sensitive: a policy that moves an indicator as hard as policies realistically
can takes that line to 100 or 0, rather than nudging it by a point.

| Indicator | A decisive move is |
|---|---|
| Rent-burdened renters | 1.2 points off the burden line |
| Price to income | a third of a year of income |
| New homes a year | 130 more homes a year |
| Households priced out | 130 households kept in town |
| Jobs | a further 1.2% of the town's jobs |
| Storefront businesses | 4.5% more storefronts |
| Storefront vacancy | 1.8 points off the empty shopfronts |
| Town budget | a tenth of the Town's net position, about 5¢ on the rate |
| Average commute | a quarter-minute, which almost nothing shifts |
| Access to jobs | 5% more jobs within a normal commute |
| Bus ridership | 15% more trips |
| Car traffic | 3 points off peak traffic |
| Tree cover | 3 points of canopy |
| Commute CO₂ | 3.5% of commute carbon |
| Commuters driving | 1 point of commuters off the road |
| Tax burden | 0.35 points of a homeowner's income |

### 4. Two halves, then the midpoint

Each half is the weighted mean of its own indicators; overall is the mean of the two halves, so the side with more
indicators can't drown out the other.

**Economy — is the town earning its living?** New homes a year, jobs, storefront businesses, storefront vacancy, the
Town's budget.

**Residents — are the people here better off?** Rent burden (weight 2), households priced out (1.5), tree cover (1.5),
tax burden (1.5), price to income, commute, access to jobs, bus ridership (0.5), car traffic (0.5), commute CO₂
(0.75), commuters driving (0.75).

The weights are where the value judgement is deliberately loud. Rent burden counts double because it is the clearest
measure of whether living here is affordable. Displacement, losing the woods and the tax bill count 1.5 because the
brief named them as what makes residents unhappy. Bus ridership, traffic, CO₂ and car share are weighted below 1
because they overlap — four readings of the same transport story shouldn't outvote housing.

The residents' half also carries a **mood** — much better off, better off, about as before, worse off, much worse off —
and a sentence naming the two indicators that carried it and the two that pulled against it, so the player gets the
why and not just the number.

### What it comes out at

Doing nothing is 50 exactly. Realistic packages land between about 32 and 69 overall, and the halves move further: a
full build-and-transit package reaches 78.7 on the economy, releasing the edge of town at its maximum drops residents
to 45.3 as the canopy goes, and a tax cut and sprawl together score 62.2 on the economy against 32.5 for residents —
the whole point being that the two halves can disagree.

## Losing

A score only means something if a player can lose it, so the library carries policies that make Chapel Hill worse. Each
is tempting for a real reason, and each costs more than it brings in. Scored at the slider's default, then at its worst:

| Policy | Default | Worst | What goes wrong |
|---|---|---|---|
| Require below-market homes in every new building | 39.3 | **32.3** | A steep set-aside with no floor area given back is a cost on building with nothing in return; new homes a year falls to 0 |
| Send new buildings back for more review | 45.8 | 39.6 | The model charges each month of review as carrying cost, 4% of a home's cost a year, and it lands in rents |
| Impact fee on each new home | 47.9 | 44.2 | The Town's budget line climbs to 88 while the fee lands on buyers, about $1.60 of price per $1 charged |
| Cut the charge for downtown parking | 47.4 | 41.8 | Residents drop to 38: the Town loses the fees and keeps the deck debt, and a more desirable downtown lifts home values, rents and the households priced out |
| Bring back parking minimums | 46.3 | 40.5 | Already in the library, and the worst of the ones that were |
| Property tax cut of 10¢ | — | 46.1 | Economy 53.8, residents 38.4. The halves disagree more than anywhere else |

The two-sided ones are the point. A tax cut reads well on the economy and badly for residents; a tax **rise** is the
mirror of it (46.4 against 64.2). The growth that grants and new homes buy arrives as traffic and rent, so almost
nothing is good on both halves at once — upzoning near transit (68.1 and 55.6) and infill in the town core (76.7 and
53.0) are the exceptions, and a full build-and-transit package reaches 68.7 overall.

### A limit worth knowing

Because the score is relative to doing nothing and leans on affordability, **making the town less desirable can read as
a gain for residents.** Cutting bus service to a quarter takes access to jobs, ridership, traffic, CO₂ and car share all
to 0 — and still scores 50.1 overall, with residents at 58.3. The mechanism is real: transit access is capitalised into
rents, so a town that is harder to reach is a cheaper one, and Chapel Hill Transit is fare-free and Town-funded, so
cutting it is a saving.

What tips it is not that affordability outweighs transport — the five transport readings carry 3.5 between them, exactly
what rent burden and households priced out carry. It is that **more lines move than transport's**: rent burden (2),
price to income (1), households priced out (1.5) and the tax bill (1.5) all peg at 100, six weight against transport's
three and a half at 0. Every clamp lands on the same side.

No card in the library cuts bus service, for this reason. If it matters more later the fix is in
`shared/indicators.js` — a larger transport swing, or less weight on affordability — not in the scorer.

## The anchors

These describe what a good and a bad town look like in **absolute** terms. The score no longer reads them — it reads
the swings above — but they set the context the panel shows beside each value, they are where the swings were sized
from, and they are what a later absolute reading would use. Each carries its reasoning in `shared/indicators.js`.
Where a published benchmark exists it is used; the rest are marked **our choice**.

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
- **It does not score context numbers.** Median rent, median home value, households, affordable homes added, tax
  revenue and median household income stay in the panel but out of the score. A rising home value is good for owners
  and bad for first buyers; rent is already measured against income by rent burden; and median income is the sharpest
  case of all — only job training and cash help change what a household earns, and no card in the library asks for
  either, so against the no-policy town it moves with who is still living here. Scoring it made displacement read as an economic gain: a deep tax cut that forced out 171 extra
  households scored 88 on "real income", and the economy half's sentence read *Better on real income*. It is context
  now, to be read beside households priced out.
- **It is not a forecast.** It scores one central run. CH-LUTI's 200-run range is still shown per indicator; the score
  is a reading of the middle of it.

## Tuning it

Change the numbers in the `score` block next to an indicator in `shared/indicators.js` — category, basis, **swing**,
weight, anchors — and the panel, the final screen and the tests all follow. The swing is the dial for sensitivity:
halve it and that indicator reacts twice as hard. `tests/health.test.js` holds the contract: doing nothing scores
exactly 50 everywhere, a full swing is worth 50 points and is clamped past it, the halves are weighted means, and
building homes, releasing the edge of town, cutting tax and running more buses each move the score the way the models
say they should.
