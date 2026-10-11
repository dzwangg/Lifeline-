# City-health indicators

What the results panel measures, why, and how a later health rating can use it. The list lives in
[`shared/indicators.js`](../shared/indicators.js); `tests/indicators.test.js` checks that every "today" value matches the data
files and that the models' first year reproduces it.

## Where the old metrics came from

They were not taken from a research paper's list. The first metrics (homes, median rent, tree cover, commute, tax revenue)
came from the project brief. The rest were added as the models grew: whatever CH-LUTI and the household model computed
(jobs, storefront businesses, downtown vacancy, bus ridership, traffic, households, priced out, home value, the budget).
Each number was real at year 0, calibrated to Census and Town data. But the panel never said what each one was for, which
way was better, or what to compare it with, so it read like a list of random numbers.

## The framework

Six questions a town asks of itself. They follow the Town Council's strategic focus areas (environmental stewardship;
economic and financial stewardship; housing) and the categories of the AARP Livability Index, the most widely used
scorecard for US places (housing, transportation, environment, opportunity).

| Pillar | Question | Indicators (★ new) | Better |
|---|---|---|---|
| Housing affordability | Can people afford a home here? | ★ renters paying 30%+ of income on rent · ★ home price to income · median rent · homes · ★ income-restricted homes added | lower · lower · lower · higher · higher |
| Staying put | Can the people who live here stay? | households priced out · households | lower · context |
| Local economy | Are there jobs and a lively downtown? | jobs · storefront businesses · downtown storefront vacancy · median home value | higher · higher · lower · context |
| Getting around | Can people reach work easily? | average commute · ★ access to jobs · bus ridership · car traffic | lower · higher · higher · lower |
| Environment | Is the town getting greener or dirtier? | tree cover · ★ commute CO₂ · ★ commuters driving | higher · lower · lower |
| Town finances | Can the Town pay for its services? | town budget impact · property tax revenue | higher · context |

"Context" numbers are worth seeing but are neither good nor bad by themselves. A rising home value makes owners richer
and first homes dearer, and more households is just growth. A rating should not score them.

### Why each new one

- **Renters paying 30%+ of income on rent.** HUD's cost-burden line is the standard US affordability measure. Chapel Hill
  is at 60.8%, against 48.9% for North Carolina and 51.1% for the US (ACS 2020–2024, B25070). Median rent alone says
  little, because rents and incomes both rise with inflation.
- **Home price to income.** The median home value is 7.1 years of the median household income, against 4.0 for the state
  (B25077 ÷ B19013). It answers whether buying is within reach.
- **Income-restricted homes added.** These are homes that rent below market by rule, from the affordable-housing
  requirement lever. The total today isn't in the model, so only additions count.
- **Access to jobs.** These are the jobs residents can reach, weighted by travel time by the modes they have. It is the
  standard planning measure of opportunity, and better than commute time alone. A shorter commute can also mean fewer
  places to work.
- **Commute CO₂.** This is the car-kilometres driven on commutes to, from and within town, at EPA's 400 g CO₂ a mile. The
  Town's Climate Action and Response Plan (2021) names transportation as its second-largest source to cut. In-commuters
  count, so homes built in town that replace long drives in show up here.
- **Commuters driving.** At 73.8%, this is far below the state's 95.6% (B08301). Mode shift is the plan's transportation
  lever.

### Benchmarks

Where a published comparison exists, the indicator carries it: North Carolina and the US from the same ACS release, the
Town's own target of about 485 new homes a year (Complete Community Strategy, 2022, from the 2021 housing needs study,
against 334 a year permitted in 2015–2025), the LUMO canopy rule for new development, and the general fund. Where none
exists (priced out, storefront businesses, traffic), the comparison is the same town with no new policy, which the panel
already shows.

## The health rating

Built: the score that reads these indicators is [health-score.md](health-score.md). It uses the `score` block on each
indicator — which half it belongs to, the basis it is read in, the anchors that score 0 and 100, and its weight.
Indicators with no `score` block are context and stay out of the number.
