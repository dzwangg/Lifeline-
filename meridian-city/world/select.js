// Building selection: click a building (a drag still pans) to outline it in gold and open an info card.
// The outline draws on top of everything, so a selection stays visible behind trees and other buildings.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.169.0/+esm';
import { P } from './palette.js';

export function mountSelection({ view, buildings, host = document.body, onSelect = () => {} }) {
  const { scene, renderer } = view;
  const mat = new THREE.LineBasicMaterial({ color: P.goldLight, depthTest: false, transparent: true });
  const under = new THREE.LineBasicMaterial({ color: P.ink, depthTest: false, transparent: true, opacity: .8 });
  let outline = null, selected = null;

  const card = document.createElement('section');
  card.className = 'retro-card building-card';
  card.hidden = true;
  card.setAttribute('aria-live', 'polite');
  card.innerHTML = `<header><h2 class="building-card__title"></h2><button type="button" class="retro-icon-btn" aria-label="Close building info">×</button></header><dl class="building-card__facts"></dl>`;
  host.append(card);
  card.querySelector('button').addEventListener('click', () => select(null));

  function ringLines(m) {
    const pts = [], r = m.outer, n = r.length / 2, top = m.wall ?? m.height;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, ax = r[2 * i], az = r[2 * i + 1], bx = r[2 * j], bz = r[2 * j + 1];
      pts.push(ax, .15, az, bx, .15, bz, ax, top, az, bx, top, bz, ax, .15, az, ax, top, az);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }

  function select(m) {
    if (outline) { scene.remove(outline); outline.children.forEach(c => c.geometry.dispose()); outline = null; }
    selected = m;
    if (!m) { card.hidden = true; onSelect(null); return; }
    const g = ringLines(m);
    outline = new THREE.Group();
    const shadow = new THREE.LineSegments(g, under), glow = new THREE.LineSegments(g, mat);
    shadow.renderOrder = 998; glow.renderOrder = 999;
    shadow.position.y = -.25;
    outline.add(shadow, glow);
    scene.add(outline);
    card.querySelector('.building-card__title').textContent = m.name ?? m.label;
    const facts = [
      ['Type', m.name ? m.label : FRIENDLY[m.type] ?? m.label],
      m.floors ? ['Storeys', String(m.floors)] : null,
      ['Height', `${Math.round(m.height)} m`],
      ['Footprint', `${Math.round(m.area).toLocaleString()} m²`],
      ...(m.growth ? growthFacts(m.growth) : []),
    ].filter(Boolean);
    card.querySelector('.building-card__facts').replaceChildren(...facts.flatMap(([k, v]) => {
      const dt = document.createElement('dt'), dd = document.createElement('dd');
      dt.textContent = k; dd.textContent = v;
      return [dt, dd];
    }));
    card.hidden = false;
    onSelect(m);
  }

  // A click is a press and release within a few pixels; anything longer is a pan.
  let down = null;
  const el = renderer.domElement;
  el.addEventListener('pointerdown', e => { if (e.button === 0) down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  el.addEventListener('pointerup', e => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5 || performance.now() - down.t > 450) { down = null; return; }
    down = null;
    if (e.defaultPrevented) return; // a walker took this click (traffic.js)
    const hits = view.raycastScreen(e.clientX, e.clientY, buildings.pickables);
    const hit = hits.find(h => h.object.userData.owner?.[h.faceIndex] >= 0);
    select(hit ? buildings.meta[hit.object.userData.owner[hit.faceIndex]] : null);
  });
  addEventListener('keydown', e => { if (e.key === 'Escape' && selected && !e.target.closest?.('[role="dialog"]')) select(null); });

  // A gentle pulse so the selection reads against busy artwork.
  return {
    select, get selected() { return selected; },
    update(time) { if (outline) mat.opacity = .75 + .25 * Math.sin(time * 4); },
  };
}

// A planned building (growth/): its homes, and how its parcel's homes compare with what the policy asked for.
function growthFacts({ homes, occupied, plan }) {
  const out = [['Homes', occupied < homes ? `${occupied} of ${homes} filled` : String(homes)], [plan.parcels.length > 1 ? 'Block' : 'Parcel', `${plan.parcels.length > 1 ? `${plan.parcels.length} parcels` : plan.id} · ${plan.occupied} of ${plan.requested} homes`]];
  if (plan.unmet) out.push(['Didn’t fit', `${plan.unmet} home${plan.unmet === 1 ? '' : 's'} (${plan.reason})`]);
  return out;
}

const FRIENDLY = {
  detached: 'House', house: 'House', semidetached_house: 'Semi-detached house', terrace: 'Terraced houses', apartments: 'Apartments',
  dormitory: 'Residence hall', residential: 'Residential', retail: 'Shops', commercial: 'Commercial', university: 'University building',
  school: 'School', church: 'Church', chapel: 'Chapel', office: 'Offices', hospital: 'Hospital', government: 'Government',
  garage: 'Garage', shed: 'Shed', roof: 'Shelter', stadium: 'Stadium', parking: 'Parking garage', industrial: 'Industrial',
};
