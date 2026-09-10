"""Prepare the standard-gachapon archive without writing shared importer files.

Run after coordinating with the database importer owner. --patch prints an
apply_patch-compatible change; otherwise verify that both editions are retained.
The current pool keeps its upstream ID for import_db compatibility. Older uses
of that event ID receive a date suffix so future imports cannot erase them.
Cosmetic/comet/salon pools are deliberately excluded from the item database.
"""

import argparse
import json
import re
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ARCHIVE = ROOT / "tools/gacha_archive.json"


def period_key(pool):
    return re.sub(r"\D", "", pool["period"][:10])


def merge_pools(previous_pools, current_pools):
    by_id = {}
    for pool in [*previous_pools, *current_pools]:
        previous = by_id.get(pool["id"])
        if previous and previous["period"] != pool["period"]:
            historical = {**previous, "id": f'{previous["id"]}-{period_key(previous)}'}
            by_id[historical["id"]] = historical
        by_id[pool["id"]] = pool
    return sorted(by_id.values(), key=lambda pool: (pool["period"], pool["id"]))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, type=Path, help="Checkout containing gacha-simulator-data.js")
    parser.add_argument("--baseline-ref", help="Recover an earlier archive from a known git revision if an import already replaced it")
    parser.add_argument("--patch", action="store_true", help="Emit patch instead of verifying the local archive")
    args = parser.parse_args()
    source_text = (args.source / "gacha-simulator-data.js").read_text(encoding="utf-8")
    prefix = "window.MS_GACHA_SIM_DB = "
    if not source_text.startswith(prefix):
        raise ValueError("Unexpected source format")
    source = json.loads(source_text[len(prefix):].strip().removesuffix(";"))
    old = ARCHIVE.read_text(encoding="utf-8")
    archive = json.loads(old)
    previous = []
    if args.baseline_ref:
        baseline = subprocess.check_output(
            ["git", "show", f"{args.baseline_ref}:tools/gacha_archive.json"],
            cwd=ROOT, encoding="utf-8",
        )
        previous.extend(json.loads(baseline)["pools"])
    previous.extend(archive["pools"])
    current = []
    for pool in source["pools"]:
        if pool.get("kind") != "standardGachapon":
            continue
        ids = sorted({item["itemId"] for item in pool["prizes"] if item.get("itemId")})
        if not ids:
            raise ValueError("Standard gachapon has no item IDs")
        current.append({"id": pool["id"], "name": pool["name"], "period": pool["period"], "items": ids})
    if not current:
        raise ValueError("Source has no standard gachapon pool")
    merged = {"pools": merge_pools(previous, current)}
    if args.patch:
        print("*** Begin Patch\n*** Update File: maple-classic-calc/tools/gacha_archive.json\n@@")
        for line in old.splitlines():
            print("-" + line)
        for line in json.dumps(merged, ensure_ascii=False, indent=1).splitlines():
            print("+" + line)
        print("*** End Patch")
        return
    if archive != merged:
        raise ValueError("Archive is missing an edition; coordinate importer access and inspect --patch")
    for pool in merged["pools"]:
        print(f'{pool["id"]}: {len(pool["items"])} items, {pool["period"]}')
    print("Archive retains current and historical standard-gachapon items.")


if __name__ == "__main__":
    main()
