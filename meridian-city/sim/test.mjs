// Checks for the CH-LUTI model: calibration to the base year, determinism, policy directions, and whether the behaviour that
// emerges from the submodels lands inside published ranges. Run: node meridian-city/sim/test.mjs
import { simulate, midParams, QUARTERS } from './model.js';
import { runScenario, explain } from './run.js';
import { TOWN, ZONES } from './data.js';
import { POLICIES } from '../policy/policies.js';

let failed = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); if (!ok) failed++; };
const pct = x => `${(x * 100).toFixed(2)}%`;
const p = midParams();
const base = simulate(p, []), B = base.series;
const card = id => POLICIES.find(x => x.id === id);
const at = (run, k, q = QUARTERS - 1) => run.series[q][k];
const rel = (run, k, q = QUARTERS - 1) => (at(run, k, q) - B[q][k]) / Math.abs(B[q][k]);

console.log('\n— calibration to the base year —');
check('population matches ACS', Math.abs(B[0].population / TOWN.population - 1) < 0.005, `${Math.round(B[0].population)} vs ${TOWN.population}`);
check('households match ACS', Math.abs(B[0].households / TOWN.households - 1) < 0.005, `${Math.round(B[0].households)} vs ${TOWN.households}`);
check('jobs match LODES', Math.abs(B[0].jobs / TOWN.jobs - 1) < 0.005, `${Math.round(B[0].jobs)} vs ${TOWN.jobs}`);
const permits = Object.values(TOWN.permitsPerYear), avgPermits = permits.reduce((a, b) => a + b) / permits.length;
check('starts match 2015–25 permits', Math.abs(B[0].starts / avgPermits - 1) < 0.1, `${Math.round(B[0].starts)}/yr vs ${Math.round(avgPermits)}/yr`);
check('market rent matches Zillow 2026', Math.abs(B[0].rent / TOWN.marketRent[2026] - 1) < 0.02, `$${Math.round(B[0].rent)} vs $${TOWN.marketRent[2026]}`);
check('rent burden matches ACS', Math.abs(B[0].rentBurden - TOWN.rentBurdened) < 0.01, `${pct(B[0].rentBurden)} vs ${pct(TOWN.rentBurdened)}`);
check('property tax ≈ base × 50¢', Math.abs(B[0].propertyTax / (TOWN.taxBase * 0.005) - 1) < 0.03, `$${(B[0].propertyTax / 1e6).toFixed(1)}M`);
check('transit ridership matches 2025', Math.abs(B[0].transitRidership / TOWN.transitRidership - 1) < 0.01);
check('commute time near ACS 19.5 min', Math.abs(B[0].commuteTime - TOWN.meanCommuteMin) < 4, `${B[0].commuteTime.toFixed(1)} min`);
const zs = base.zones[0];
const zoneBus = ZONES.map((z, i) => Math.abs(zs[i].busShare - z.modeShare.bus / (z.modeShare.car + z.modeShare.bus + z.modeShare.bike + z.modeShare.walk)));
check('zone bus shares match ACS', Math.max(...zoneBus) < 0.01, zoneBus.map(x => x.toFixed(3)).join(' '));
const rentGrowth = (B[39].rent / B[0].rent) ** (1 / (39 / 4)) - 1;
check('baseline rent growth within the 2015–2026 record', rentGrowth > 0.015 && rentGrowth < 0.055, `${pct(rentGrowth)}/yr (ZORI: 2.2%–5.1%)`);
const jobGrowth = (B[39].jobs / B[0].jobs) ** (1 / (39 / 4)) - 1;
check('baseline job growth within the LODES record', jobGrowth > 0.002 && jobGrowth < 0.015, `${pct(jobGrowth)}/yr (LODES 2002–23: 1.3%)`);

console.log('\n— determinism and neutrality —');
check('same inputs, same outputs', JSON.stringify(simulate(p, []).series) === JSON.stringify(B));
check('an empty package equals the baseline', JSON.stringify(simulate(p, [], {}).series) === JSON.stringify(B));
const free = simulate(p, [{ id: 'noop', levers: [{ lever: 'business.supportGrants', value: 0 }] }]);
check('a zero-valued lever changes nothing', JSON.stringify(free.series) === JSON.stringify(B));

console.log('\n— emergent behaviour vs. literature —');
const shock = simulate(p, [], { shock: { units: 0.01 } });
const rentElast = (shock.series[20].rent / B[20].rent - 1) / 0.01;
check('rent response to +1% homes (5 yrs)', rentElast < -0.08 && rentElast > -0.7, `${rentElast.toFixed(2)} (Mense 2025: −0.19; Asquith et al. 2023: ~−0.6 locally)`);
const svc = simulate(p, [{ id: 's', levers: [{ lever: 'transit.serviceMultiplier', value: 1.1 }] }]);
const busElast = Math.log(svc.series[8].busShare / B[8].busShare) / Math.log(1.1);
check('resident bus share response to +10% service', busElast > 0.1 && busElast < 1.0, `${busElast.toFixed(2)} (TCRP 95: 0.3–1.0 for ridership)`);
const up = simulate({ ...p, rentDrift: p.rentDrift + 0.01 }, []);
const supplyElast = Math.log(up.series[39].housingUnits / B[39].housingUnits) / Math.log(up.series[39].rent / B[39].rent);
check('10-yr housing supply elasticity', supplyElast > 0.2 && supplyElast < 2.5, `${supplyElast.toFixed(2)} (Saiz 2010: ~0.8 for Raleigh–Durham)`);

console.log('\n— policy directions (10 years, central parameters) —');
const run = id => simulate(p, [card(id)]);
const r = Object.fromEntries(POLICIES.map(x => [x.id, run(x.id)]));
check('upzoning adds homes', rel(r['transit-upzoning'], 'housingUnits') > 0.01, pct(rel(r['transit-upzoning'], 'housingUnits')));
check('upzoning lowers rent vs. baseline', rel(r['transit-upzoning'], 'rent') < 0, pct(rel(r['transit-upzoning'], 'rent')));
check('construction subsidy adds homes', rel(r['housing-construction-subsidy'], 'housingUnits') > 0, pct(rel(r['housing-construction-subsidy'], 'housingUnits')));
check('parking reduction adds homes', rel(r['parking-minimum-reduction'], 'housingUnits') > 0, pct(rel(r['parking-minimum-reduction'], 'housingUnits')));
check('tax cut lowers revenue', at(r['property-tax-adjustment'], 'propertyTax') < B[39].propertyTax);
check('support grants add businesses', rel(r['small-business-support-grant'], 'businesses') > 0);
check('start-up grants add businesses', rel(r['new-business-startup-grant'], 'businesses') > 0);
check('hiring subsidy adds jobs', rel(r['hiring-subsidy'], 'jobs') > 0);
check('vacancy tax fills storefronts', at(r['storefront-vacancy-tax'], 'storefrontVacancy') < B[39].storefrontVacancy);
check('more buses, more riders', rel(r['bus-frequency-boost'], 'transitRidership') > 0.05, pct(rel(r['bus-frequency-boost'], 'transitRidership')));
check('more buses, less car traffic', rel(r['bus-frequency-boost'], 'trafficIndex') < 0, pct(rel(r['bus-frequency-boost'], 'trafficIndex')));
check('bike network raises cycling', rel(r['protected-bike-network'], 'bikeShare') > 0, pct(rel(r['protected-bike-network'], 'bikeShare')));
check('upzoning builds more projects', r['transit-upzoning'].events.length > base.events.length, `${r['transit-upzoning'].events.length} vs ${base.events.length} buildings`);

console.log('\n— Monte Carlo —');
const t0 = performance.now();
const sc = runScenario([card('transit-upzoning'), card('bus-frequency-boost')], { runs: 200 });
const ms = performance.now() - t0;
check('200 paired runs in under 3 s', ms < 3000, `${ms.toFixed(0)} ms`);
const ordered = Object.values(sc.diff).every(b => b.p10.every((v, q) => v <= b.p50[q] + 1e-9 && b.p50[q] <= b.p90[q] + 1e-9));
check('bands are ordered p10 ≤ p50 ≤ p90', ordered);
check('same seed, same bands', JSON.stringify(runScenario([card('transit-upzoning')], { runs: 30 }).diff.rent) === JSON.stringify(runScenario([card('transit-upzoning')], { runs: 30 }).diff.rent));
const why = explain(sc, 'rent', 39);
check('the trace finds a cause for rent', why.children.length > 0, why.children.map(c => c.id).join(', '));

console.log('\n— 10-year effects at central parameters (vs. baseline) —');
const fmtRow = (id, s) => `${id.padEnd(30)} homes ${pct(rel(s, 'housingUnits')).padStart(7)}  rent ${pct(rel(s, 'rent')).padStart(7)}  jobs ${pct(rel(s, 'jobs')).padStart(7)}  businesses ${pct(rel(s, 'businesses')).padStart(7)}  riders ${pct(rel(s, 'transitRidership')).padStart(7)}  traffic ${pct(rel(s, 'trafficIndex')).padStart(7)}  budget ${((at(s, 'netFiscal') - B[39].netFiscal) / 1e6).toFixed(2).padStart(6)} $M/yr`;
for (const x of POLICIES) console.log(fmtRow(x.id, r[x.id]));

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
