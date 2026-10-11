# Production smoke test, 2026-10-11 ~00:00 ET
origin/main 712d955 (#17 merged after #15), deploy lifeline-5o09a1mei.

| Check | Result |
|---|---|
| npm test / lint | PASS (129/129) |
| /api/narration (core-infill) | PASS: 200, 2.8 s, live Gemini + ElevenLabs audio |
| /api/resident-bank (uma, core-infill) | PASS: 200, 2.4 s, but ledger source: local (no Nessie) |
| /api/resident (one question) | FAIL: fallback "no Gemini key" (POST env default bug, fixed in #18) |
| /api/policies/generate | WARN: card drafted, signature null |
| CARD_SIGNING_KEY | FAIL: missing in production (added 2026-10-11 00:10) |
| Model that answered | Unconfirmed: replies don't report the model |
| Map renders | PASS: 3,283 buildings, 1.6 s |
| Policy card applies | PASS |
| Resident demo page | PASS: Uma's budget loads, no console errors |
| Console | /favicon.ico 404 (cosmetic) |
