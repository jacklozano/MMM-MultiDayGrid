/**
 * MMM-MultiDayGrid - feed fetching.
 *
 * Feeds are fetched IN PARALLEL and fail INDEPENDENTLY. Both matter:
 * there is no disk cache, so the grid shows a loading state until data
 * arrives - fetching six feeds sequentially at a 90s timeout would put first
 * paint six timeouts deep, and one dead feed would hold the whole grid hostage.
 *
 * Uses global fetch (Node 18+), so no HTTP dependency.
 */
"use strict";

const ical = require("node-ical");
const { expandEvents } = require("./expand.js");
const { normalize } = require("./normalize.js");

/** now.startOf(day) - days .. now.startOf(day) + days, matching what the grid can show. */
function windowFor (config, now) {
  now = now || new Date();
  const days = Math.max(1, Math.min(4, config.days || 3));
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const from = new Date(start);
  if (config.includePastEvents !== false) from.setDate(from.getDate() - days);
  const to = new Date(start);
  to.setDate(to.getDate() + days + 1);        // +1 day of margin for timezone edges
  return { from, to };
}

async function fetchOne (cal, config, now) {
  const timeout = config.fetchTimeout || 90000;
  const started = Date.now();
  try {
    const res = await fetch(cal.url, {
      signal: AbortSignal.timeout(timeout),
      headers: { "User-Agent": "MMM-MultiDayGrid" },
      redirect: "follow"
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.text();
    if (body.indexOf("BEGIN:VCALENDAR") === -1) throw new Error("response is not iCal");

    const data = ical.parseICS(body);
    const { from, to } = windowFor(config, now);
    const instances = expandEvents(data, from, to);
    const events = normalize(instances, cal, config);

    return {
      name: cal.name, ok: true, events,
      fetchedAt: Date.now(), ms: Date.now() - started,
      stats: {
        bytes: body.length,
        topLevel: Object.keys(data).length,
        instances: instances.length,
        orphanParents: instances.stats ? instances.stats.orphanParents : 0,
        promoted: instances.stats ? instances.stats.promoted : 0
      }
    };
  } catch (err) {
    return {
      name: cal.name, ok: false, events: [],
      fetchedAt: null, ms: Date.now() - started,
      error: err.name === "TimeoutError" ? `timed out after ${timeout}ms` : err.message
    };
  }
}

/** Fetch every calendar concurrently. Never rejects - failures come back as ok:false. */
async function fetchAll (calendars, config, now) {
  return Promise.all(calendars.map((c) => fetchOne(c, config, now)));
}

module.exports = { fetchAll, fetchOne, windowFor };
