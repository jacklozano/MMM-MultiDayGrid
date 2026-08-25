#!/usr/bin/env node
/**
 * MMM-MultiDayGrid - standalone fetcher entrypoint.
 *
 * The same code node_helper.js calls, runnable without MagicMirror. This is
 * what makes the dev loop fast: edit, sync, run, read numbers - no mirror, no
 * browser, no deploy.
 *
 *   node lib/cli.js                     # summary table
 *   node lib/cli.js --json              # wire events to stdout (for diff.py)
 *   node lib/cli.js --config path.json  # default: ./calendars.json
 *   node lib/cli.js --local dir/        # parse .ics files from disk instead of fetching
 */
"use strict";

const fs = require("fs");
const path = require("path");
const ical = require("node-ical");
const { validate } = require("./validate.js");
const { fetchAll, windowFor } = require("./fetch.js");
const { expandEvents } = require("./expand.js");
const { normalize } = require("./normalize.js");

function arg (name, fallback) {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : (process.argv[i + 1] || true);
}
const asJson = process.argv.includes("--json");

function localRun (dir, calendars, config) {
  return calendars.map((cal) => {
    const slug = cal.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const file = path.join(dir, slug + ".ics");
    if (!fs.existsSync(file)) return { name: cal.name, ok: false, events: [], error: "no local file " + file };
    const data = ical.parseICS(fs.readFileSync(file, "utf8"));
    const { from, to } = windowFor(config, new Date());
    const instances = expandEvents(data, from, to);
    return {
      name: cal.name, ok: true, events: normalize(instances, cal, config), ms: 0,
      stats: { instances: instances.length,
               orphanParents: instances.stats ? instances.stats.orphanParents : 0,
               promoted: instances.stats ? instances.stats.promoted : 0 }
    };
  });
}

(async function main () {
  const cfgPath = arg("--config", "./calendars.json");
  const raw = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  const config = Object.assign({ days: 3, hourLength: 16, allDayThresholdHours: 23 }, raw);

  const v = validate(config);
  if (v.fatal.length) {
    console.error("FATAL:");
    v.fatal.forEach((f) => console.error("  " + f));
    process.exit(1);
  }
  v.problems.forEach((p) => console.error("warn: " + p));

  const local = arg("--local", null);
  const results = local ? localRun(local, v.calendars, config)
                        : await fetchAll(v.calendars, config, new Date());

  if (asJson) {
    const all = [];
    results.forEach((r) => all.push(...r.events));
    process.stdout.write(JSON.stringify(all, null, 2));
    return;
  }

  const { from, to } = windowFor(config, new Date());
  console.log(`\nwindow ${from.toISOString().slice(0, 10)} .. ${to.toISOString().slice(0, 10)}  (days:${config.days}, TZ=${process.env.TZ || "unset"})\n`);
  console.log("calendar                 ok      ms   inst  orph  promo  events  allDay");
  console.log("-".repeat(76));
  let tot = 0, totAll = 0;
  for (const r of results) {
    const st = r.stats || {};
    const ad = r.events.filter((e) => e.allDay).length;
    tot += r.events.length; totAll += ad;
    console.log(
      r.name.padEnd(24) +
      (r.ok ? "  ok" : " ERR").padStart(4) +
      String(r.ms).padStart(8) +
      String(st.instances == null ? "-" : st.instances).padStart(7) +
      String(st.orphanParents == null ? "-" : st.orphanParents).padStart(6) +
      String(st.promoted == null ? "-" : st.promoted).padStart(7) +
      String(r.events.length).padStart(8) +
      String(ad).padStart(8) +
      (r.ok ? "" : "   " + r.error));
  }
  console.log("-".repeat(76));
  console.log("TOTAL".padEnd(24) + " ".repeat(28) + String(tot).padStart(8) + String(totAll).padStart(8));
  const failed = results.filter((r) => !r.ok);
  if (failed.length) console.log("\n" + failed.length + " feed(s) failed: " + failed.map((f) => f.name).join(", "));
})().catch((e) => { console.error(e); process.exit(1); });
