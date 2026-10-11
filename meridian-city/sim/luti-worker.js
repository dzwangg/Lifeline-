// Runs CH-LUTI's 200 paired simulations off the main thread, so sliders and the map stay responsive.
import { runScenario } from '../../shared/luti/run.js';

self.onmessage = ({ data: { version, policies, landUse, quarters, drivers, assumptions, baselines } }) => self.postMessage({ ...runScenario(policies, assumptions, baselines, { landUse, quarters, drivers }), version });
