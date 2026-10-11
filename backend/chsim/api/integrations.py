"""Optional sponsor integrations. Both are off unless their key is set, and neither can create predictions.

Gemini  summarises an already-validated result. It receives only the result's summary numbers and labels, and is told
        not to add numbers, coefficients or causal claims. Without GEMINI_API_KEY a deterministic template is used.
Nessie  (Capital One mock banking API) mirrors a scenario's funding ledger as SYNTHETIC transactions for a demo.
        Never historical evidence, never real money, never used as model input.
"""
from __future__ import annotations
import json, os
import httpx

GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")


def _facts(r: dict) -> dict:
    by = {m["id"]: m for m in r["metrics"] if m.get("supported")}
    last = lambda k: by[k]["series"][-1] if k in by else None
    keep = ["workplace_jobs", "resident_jobs", "housing_net_stock_change", "restricted_stock", "receipts_property_tax",
            "policy_disbursements", "operating_balance", "funding_gap"]
    return {"final_year": r["years"][-1], "label": r["label"], "warnings": r["warnings"],
            "enabled_policies": [p["title"] for p in r["policies"] if p["enabled"]],
            "changes": {k: {"median": last(k)["delta"]["p50"], "p10": last(k)["delta"]["p10"], "p90": last(k)["delta"]["p90"],
                            "unit": by[k]["delta_unit"], "evidence": by[k]["effect"]} for k in keep if last(k)}}


def template_explanation(r: dict) -> str:
    f = _facts(r)
    if not f["enabled_policies"]:
        return (f"No policies are enabled, so the selected path equals the current-policy baseline in every year "
                f"(all paired changes are exactly zero). {f['label']}")
    parts = [f"By {f['final_year']}, with {', '.join(f['enabled_policies'])}:"]
    for k, c in f["changes"].items():
        if c["median"] == 0 and c["p10"] == 0 and c["p90"] == 0:
            continue
        parts.append(f"- {k.replace('_', ' ')}: median change {c['median']:,.0f} {c['unit']} "
                     f"(80% interval {c['p10']:,.0f} to {c['p90']:,.0f}; basis: {c['evidence']}).")
    parts += [f"Warning: {w}" for w in f["warnings"]]
    parts.append(f["label"])
    return "\n".join(parts)


def gemini_explanation(r: dict) -> dict:
    key = os.environ.get("GEMINI_API_KEY")
    if not key:
        return {"source": "template", "text": template_explanation(r), "note": "GEMINI_API_KEY not set"}
    prompt = ("Summarise this policy simulation for residents in under 150 words. Use ONLY the numbers given; do not add "
              "numbers, coefficients, rankings or causal claims. Say that effects are assumption-based sensitivity results. "
              "Mention every warning.\n\n" + json.dumps(_facts(r)))
    try:
        resp = httpx.post(f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent",
                          params={"key": key}, json={"contents": [{"parts": [{"text": prompt}]}]}, timeout=30)
        resp.raise_for_status()
        text = resp.json()["candidates"][0]["content"]["parts"][0]["text"]
        return {"source": f"gemini:{GEMINI_MODEL}", "text": text, "facts": _facts(r)}
    except Exception as e:
        return {"source": "template", "text": template_explanation(r), "note": f"Gemini call failed: {type(e).__name__}"}


def nessie_synthetic_ledger(r: dict) -> dict:
    """Post the scenario's policy payments as SYNTHETIC deposits/withdrawals to a Nessie mock account."""
    key = os.environ.get("NESSIE_API_KEY")
    rows = [{"fiscal_year": l["fiscal_year"], "policy_disbursements": l["policy_disbursements"]["delta"],
             "property_tax_change": l["receipts_property_tax"]["delta"]} for l in r["ledger"]]
    if not key:
        return {"status": "disabled", "note": "NESSIE_API_KEY not set; nothing sent.", "synthetic_rows": rows}
    base = os.environ.get("NESSIE_BASE_URL", "http://api.nessieisreal.com")
    account = os.environ.get("NESSIE_ACCOUNT_ID")
    if not account:
        return {"status": "disabled", "note": "Set NESSIE_ACCOUNT_ID to a mock account you created.", "synthetic_rows": rows}
    posted = []
    for row in rows:
        for kind, amt in (("deposits", row["property_tax_change"]), ("withdrawals", row["policy_disbursements"])):
            if amt > 0:
                resp = httpx.post(f"{base}/accounts/{account}/{kind}", params={"key": key}, timeout=20, json={
                    "medium": "balance", "amount": round(amt, 2),
                    "description": f"SYNTHETIC scenario {row['fiscal_year']} {kind} (not Chapel Hill data)"})
                posted.append({"fy": row["fiscal_year"], "kind": kind, "status": resp.status_code})
    return {"status": "posted", "synthetic": True, "posted": posted}
