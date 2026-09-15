#!/usr/bin/env python3
"""
source_businesses.py

Pulls real business listings from the Google Places API (Text Search / Nearby
Search) and normalizes them into the schema the directory site expects
(data/businesses.json).

This script does NOT launch anything on-chain and does NOT contact
pons.family. It only builds a candidate list for you to review.

Requires:
    pip install requests

Environment:
    GOOGLE_PLACES_API_KEY   your own Google Places API key (never Claude's)

Usage:
    python3 source_businesses.py --query "coffee shop" --location "New York, NY" --limit 20
    python3 source_businesses.py --query "hardware store" --location "Brooklyn, NY" --out data/businesses_brooklyn.json

IMPORTANT: sourcing a business's name/logo here does not create any
relationship with that business and does not grant you rights to its brand.
Read README.md's "Before you launch anything real" checklist before turning
any row in the output file into an on-chain token.
"""
import argparse
import json
import os
import sys
import time
import urllib.parse
import urllib.request

PLACES_TEXT_SEARCH_URL = "https://maps.googleapis.com/maps/api/place/textsearch/json"
PLACE_DETAILS_URL = "https://maps.googleapis.com/maps/api/place/details/json"


def _get(url, params):
    qs = urllib.parse.urlencode(params)
    with urllib.request.urlopen(f"{url}?{qs}", timeout=20) as resp:
        return json.loads(resp.read().decode("utf-8"))


def search_places(api_key, query, location, limit):
    results = []
    params = {"query": f"{query} in {location}", "key": api_key}
    while True:
        data = _get(PLACES_TEXT_SEARCH_URL, params)
        status = data.get("status")
        if status not in ("OK", "ZERO_RESULTS"):
            raise RuntimeError(f"Places API error: {status} - {data.get('error_message')}")
        results.extend(data.get("results", []))
        if len(results) >= limit:
            break
        token = data.get("next_page_token")
        if not token:
            break
        # Google requires a short delay before a page token becomes valid.
        time.sleep(2)
        params = {"pagetoken": token, "key": api_key}
    return results[:limit]


def place_details(api_key, place_id):
    fields = "name,formatted_address,website,international_phone_number,url,business_status"
    data = _get(PLACE_DETAILS_URL, {"place_id": place_id, "fields": fields, "key": api_key})
    if data.get("status") != "OK":
        return {}
    return data.get("result", {})


def normalize(place, details, category):
    name = place.get("name", "").strip()
    slug = "".join(c for c in name.lower().replace(" ", "-") if c.isalnum() or c == "-")
    return {
        "id": f"places-{place.get('place_id')}",
        "sourcePlaceId": place.get("place_id"),
        "name": name,
        "category": category,
        "city": details.get("formatted_address", place.get("formatted_address", "")),
        "isFictionalDemo": False,
        "description": f"Unofficial community token candidate for {name}. Not created by or affiliated with the business unless claimed.",
        "logoUrl": "",
        "socials": {
            "website": details.get("website", ""),
            "twitter": "",
            "telegram": "",
            "discord": "",
            "farcaster": "",
        },
        "claim": {"status": "unclaimed", "claimedBy": None, "requestedAt": None},
        "launch": {"status": "not_launched", "tokenAddress": None, "txHash": None},
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--query", required=True, help='e.g. "coffee shop"')
    parser.add_argument("--location", required=True, help='e.g. "New York, NY"')
    parser.add_argument("--limit", type=int, default=20)
    parser.add_argument("--out", default="data/businesses.json")
    parser.add_argument("--skip-details", action="store_true", help="skip the Details call (fewer fields, fewer API credits)")
    args = parser.parse_args()

    api_key = os.environ.get("GOOGLE_PLACES_API_KEY")
    if not api_key:
        print("ERROR: set GOOGLE_PLACES_API_KEY in your environment first.", file=sys.stderr)
        sys.exit(1)

    places = search_places(api_key, args.query, args.location, args.limit)
    print(f"Found {len(places)} candidates for '{args.query}' in '{args.location}'")

    out = []
    for p in places:
        details = {} if args.skip_details else place_details(api_key, p.get("place_id"))
        out.append(normalize(p, details, args.query))

    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    # Merge with any existing file rather than clobbering earlier runs.
    existing = []
    if os.path.exists(args.out):
        with open(args.out) as f:
            existing = json.load(f)
    existing_ids = {e["id"] for e in existing}
    merged = existing + [row for row in out if row["id"] not in existing_ids]

    with open(args.out, "w") as f:
        json.dump(merged, f, indent=2)

    print(f"Wrote {len(merged)} total businesses to {args.out}")
    print("Nothing has been launched or published anywhere. Review the file, then see")
    print("README.md's 'Before you launch anything real' checklist.")


if __name__ == "__main__":
    main()
