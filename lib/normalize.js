/**
 * MMM-MultiDayGrid - the wire format.
 *
 * Converts expanded instances into the objects the browser renders.
 *
 * THE POINT OF THIS MODULE is how all-day events cross the wire. In iCal they
 * are VALUE=DATE - a floating calendar date with no timezone. node-ical parses
 * that into a Date at midnight in the SERVER's zone, which is why a UTC pod
 * puts them in the previous day's column on a UTC-6 browser.
 *
 * So all-day events are sent as a CALENDAR DATE STRING and never as a
 * timestamp. The browser places them by date, and no zone arithmetic happens
 * anywhere. The date is recovered with LOCAL getters, which round-trip
 * correctly because the same process parsed it. (MagicMirror core reaches the
 * same conclusion - see its moment.tz([getFullYear(), getMonth(), getDate()]).)
 *
 * Timed events stay as epoch milliseconds, which are unambiguous by definition.
 */
"use strict";

const DAY_MS = 86400000;

/** node-ical yields {val, params} for properties carrying parameters. */
function unwrap (v) {
  if (v && typeof v === "object" && typeof v.val !== "undefined") return v.val;
  return v;
}

function str (v) {
  const u = unwrap(v);
  return typeof u === "string" ? u : (u == null ? "" : String(u));
}

/** Local calendar date, e.g. "2026-08-15". Never toISOString() - that shifts. */
function localDate (d) {
  const p = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}

function titleOf (ev) {
  const t = str(ev.summary) || str(ev.description);
  return t.trim() || "Event";
}

function matchesRule (ev, rule) {
  const field = rule.field || "title";
  const mode = rule.match || "contains";
  const hay = field === "title" ? titleOf(ev)
            : field === "location" ? str(ev.location)
            : str(ev.description);
  const needle = String(rule.value == null ? "" : rule.value);
  if (mode === "regex") {
    try { return new RegExp(needle).test(hay); } catch (e) { return false; }
  }
  const a = rule.caseSensitive ? hay : hay.toLowerCase();
  const b = rule.caseSensitive ? needle : needle.toLowerCase();
  return mode === "equals" ? a === b : a.indexOf(b) !== -1;
}

function isExcluded (ev, rules) {
  if (!rules || !rules.length) return false;
  for (const r of rules) if (matchesRule(ev, r)) return true;
  return false;
}

/**
 * @param {object[]} instances from expandEvents()
 * @param {object} calendar   { name, color, exclude }
 * @param {object} config     { allDayThresholdHours }
 * @returns {object[]} wire events
 */
function normalize (instances, calendar, config) {
  config = config || {};
  const threshold = (config.allDayThresholdHours == null ? 23 : config.allDayThresholdHours) * 3600000;
  const out = [];

  for (const inst of instances) {
    const ev = inst.event || {};
    if (isExcluded(ev, calendar.exclude)) continue;

    let allDay = !!inst.isFullDay;
    let start = inst.start;
    let end = inst.end || inst.start;

    // A TIMED block spanning a whole day or more conveys one bit of
    // information but would otherwise fill an entire column. Re-flag it as
    // all-day so it renders as a compact chip instead.
    if (!allDay && (end - start) >= threshold) allDay = true;

    const base = {
      calendar: calendar.name,
      color: calendar.color,
      title: titleOf(ev),
      allDay: allDay,
      recurring: !!inst.isRecurring
    };

    const loc = str(ev.location);
    if (loc) base.location = loc;

    if (allDay) {
      // iCal DTEND is EXCLUSIVE for all-day events; keep that convention so the
      // renderer can treat endDate as one-past-the-last day.
      //
      // The comparison must be on DATES, not timestamps. A timed block
      // re-flagged by allDayThresholdHours (00:00-23:59) has end > start yet
      // both fall on the same calendar day, which would yield a zero-day chip
      // the renderer draws as nothing.
      base.startDate = localDate(start);
      let endStr = localDate(end);
      if (endStr <= base.startDate) endStr = localDate(new Date(start.getTime() + DAY_MS));
      base.endDate = endStr;
    } else {
      base.start = start.getTime();
      base.end = end.getTime();
    }
    out.push(base);
  }

  out.sort((a, b) => {
    const as = a.allDay ? a.startDate : a.start;
    const bs = b.allDay ? b.startDate : b.start;
    if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
    return as < bs ? -1 : as > bs ? 1 : 0;
  });
  return out;
}

module.exports = { normalize, localDate, titleOf, isExcluded, unwrap };
