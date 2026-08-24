#!/usr/bin/env node
/**
 * Core-equivalent reference implementation, for the Step 3 diff gate.
 *
 * Runs the SAME pipeline as lib/cli.js but with our two deliberate additions
 * switched off:
 *   - no orphaned RECURRENCE-ID promotion (core does not do it)
 *   - no >=23h timed-to-all-day re-flagging (core does not do it)
 *
 * Everything else - node-ical parsing, expandRecurringEvent, the window, the
 * wire format - is identical. So a diff against lib/cli.js --json isolates
 * exactly what this module adds, with zero time drift, rather than comparing
 * against a payload captured on a different day.
 */
"use strict";
const fs = require("fs");
const ical = require("node-ical");
const { validate } = require("../lib/validate.js");
const { windowFor } = require("../lib/fetch.js");
const { normalize } = require("../lib/normalize.js");

const cfgPath = process.argv[2] || "./calendars.json";
const raw = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
const config = Object.assign({ days: 3, hourLength: 16 }, raw);
config.allDayThresholdHours = Number.POSITIVE_INFINITY;   // disable re-flagging
const v = validate(config);

(async () => {
  const { from, to } = windowFor(config, new Date());
  const all = [];
  await Promise.all(v.calendars.map(async (cal) => {
    const res = await fetch(cal.url, { signal: AbortSignal.timeout(config.fetchTimeout || 90000) });
    const data = ical.parseICS(await res.text());
    const inst = [];
    for (const ev of Object.values(data)) {
      if (!ev || ev.type !== "VEVENT") continue;
      // NO promotion branch - this is the core behaviour
      let out;
      try {
        out = ical.expandRecurringEvent(ev, { from, to, includeOverrides: true, excludeExdates: true, expandOngoing: true });
      } catch (e) { continue; }
      for (const i of out) {
        const end = i.end || i.start;
        if (!(end > from && i.start < to)) continue;
        inst.push({ event: i.event || ev, start: i.start, end,
                    isRecurring: !!i.isRecurring, isFullDay: !!i.isFullDay });
      }
    }
    all.push(...normalize(inst, cal, config));
  }));
  process.stdout.write(JSON.stringify(all, null, 2));
})().catch((e) => { console.error(e); process.exit(1); });
