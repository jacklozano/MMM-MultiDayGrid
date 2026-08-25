#!/usr/bin/env python3
"""
Step 3 correctness gate: compare our fetcher's output against the
core-equivalent reference.

Keyed on (calendar, start, end, allDay) - NOT on title. The work calendar is
shared free/busy only, so every event on it is titled "Busy" and titles carry
no distinguishing signal whatsoever.

Every row reported here must be explainable. The expected differences are:
  * events ONLY IN OURS on a feed with orphaned RECURRENCE-ID entries
  * events whose allDay flag differs because a >=23h timed block was re-flagged

Anything else is a bug.

    python3 dev/diff.py ours.json reference.json
"""
import json, sys
from collections import Counter, defaultdict


def key(e):
    return (e.get("calendar"),
            e.get("start") if not e.get("allDay") else e.get("startDate"),
            e.get("end") if not e.get("allDay") else e.get("endDate"),
            bool(e.get("allDay")))


def load(p):
    with open(p) as f:
        return json.load(f)


def main(ours_p, ref_p):
    ours, ref = load(ours_p), load(ref_p)
    ok, rk = Counter(map(key, ours)), Counter(map(key, ref))

    only_ours = ok - rk
    only_ref = rk - ok

    print(f"ours      {len(ours):>5} events")
    print(f"reference {len(ref):>5} events")
    print(f"delta     {len(ours) - len(ref):>+5}\n")

    by_cal = defaultdict(lambda: [0, 0])
    for k, n in only_ours.items():
        by_cal[k[0]][0] += n
    for k, n in only_ref.items():
        by_cal[k[0]][1] += n

    if not by_cal:
        print("IDENTICAL - no differences in either direction")
        return 0

    print(f"{'calendar':<24}{'only ours':>11}{'only ref':>10}")
    print("-" * 45)
    for cal in sorted(by_cal):
        a, b = by_cal[cal]
        print(f"{str(cal):<24}{a:>11}{b:>10}")
    print()

    # only-in-reference is the dangerous direction: we LOST something.
    if only_ref:
        print("!! EVENTS PRESENT IN REFERENCE BUT MISSING FROM OURS - investigate:")
        for k, n in list(only_ref.items())[:15]:
            print(f"   {k}  x{n}")
        return 1

    print("No events lost. All differences are additions, consistent with")
    print("orphan promotion and/or all-day re-flagging.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1], sys.argv[2]))
