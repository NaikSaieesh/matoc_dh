"""
All calls to the USAspending.gov public API live in this file.
Nothing else in the app should talk to this API directly - it always
goes through pull_pipeline.py, which calls the functions below.
"""

import time
import requests

USASPENDING_BASE_URL = "https://api.usaspending.gov/api/v2"
MAX_RETRIES = 3

BASE = USASPENDING_BASE_URL


def _post_with_retries(url, payload, timeout=30):
    """POST request with a few retries so one bad network blip
    doesn't kill the whole run."""
    last_error = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            print(f"URL: {url}")
            print(f"Payload: {payload}")
            response = requests.post(url, json=payload, timeout=timeout)
            response.raise_for_status()
            return response.json()
        except requests.RequestException as exc:
            last_error = exc
            time.sleep(2 * attempt)  # back off a bit longer each retry
    raise last_error


def _get_with_retries(url, timeout=30):
    last_error = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            response = requests.get(url, timeout=timeout)
            response.raise_for_status()
            return response.json()
        except requests.RequestException as exc:
            last_error = exc
            time.sleep(2 * attempt)
    raise last_error


def get_award_id_by_piid(piid):
    """Look up USAspending's internal award id for a given PIID/task order number."""
    url = f"{BASE}/search/spending_by_award/"
    payload = {
        "filters": {
            "award_type_codes": ["A", "B", "C", "D"],
            "keywords": [piid],
        },
        "fields": [
            "Award ID",
            "generated_internal_id",
            "Recipient Name",
            "Award Amount",
        ],
        "limit": 10,
    }

    data = _post_with_retries(url, payload)
    results = data.get("results", [])

    for r in results:
        if r.get("Award ID") == piid:
            return r.get("generated_internal_id")

    return None


def get_award_summary(generated_id):
    """Fetch the full award summary for an internal award id."""
    url = f"{BASE}/awards/{generated_id}/"
    return _get_with_retries(url)


def get_transactions(generated_id):
    """Fetch all modifications (transactions) for an internal award id."""
    url = f"{BASE}/transactions/"
    payload = {
        "award_id": generated_id,
        "limit": 100,
        "page": 1,
        "sort": "action_date",
        "order": "asc",
    }
    data = _post_with_retries(url, payload)
    return data.get("results", [])


def fetch_award_data(piid):
    """
    High level helper: given a PIID, returns a dict with the award
    summary + list of modifications, or None if the award can't be found.
    """
    generated_id = get_award_id_by_piid(piid)
    if not generated_id:
        return None

    award = get_award_summary(generated_id)
    transactions = get_transactions(generated_id)

    modifications = []
    for t in transactions:
        modifications.append({
            "modification_number": t.get("modification_number"),
            "action_date": t.get("action_date"),
            "description": t.get("description"),
            "federal_action_obligation": t.get("federal_action_obligation"),
        })

    return {
        "piid": award.get("piid") or piid,
        "generated_internal_id": generated_id,
        "description": award.get("description"),
        "recipient_name": (award.get("recipient") or {}).get("recipient_name"),
        "total_obligation": award.get("total_obligation"),
        "base_exercised_options": award.get("base_exercised_options"),
        "base_and_all_options": award.get("base_and_all_options"),
        "modifications": modifications,
    }
