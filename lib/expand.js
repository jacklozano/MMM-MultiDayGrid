/**
 * MMM-MultiDayGrid - recurrence expansion.
 *
 * RRULE, EXDATE and RECURRENCE-ID overrides are NOT reimplemented here:
 * node-ical's own `expandRecurringEvent()` handles them, and MagicMirror core
 * delegates to exactly the same call. Reimplementing it would mean owning
 * DST and RRULE edge cases for no benefit.
 *
 * What core does NOT handle, and this module does, is ORPHANED RECURRENCE-ID
 * instances - see promoteOrphans() below.
 */
"use strict";

const ical = require("node-ical");

const EXPAND_OPTS = {
  includeOverrides: true,
  excludeExdates: true,
  expandOngoing: true
};

/** iCal all-day events are VALUE=DATE; node-ical flags them as datetype "date". */
function isAllDay (ev) {
  return ev && ev.datetype === "date";
}

/**
 * Overlap, not containment. An event that began before the window and runs
 * into it must be kept - filtering on start time alone silently drops every
 * multi-day event already in progress.
 */
function overlaps (start, end, from, to) {
  return end > from && start < to;
}

/**
 * Promote orphaned RECURRENCE-ID instances to first-class events.
 *
 * Some exports - Google Workspace free/busy in particular - publish every
 * instance of a recurring meeting as a standalone VEVENT carrying
 * RECURRENCE-ID but NO master VEVENT with an RRULE. node-ical files those
 * under `parent.recurrences`, and both MagicMirror core and node-ical's
 * expandRecurringEvent() only ever return the parent. Measured on a real
 * feed: 29 parents concealing 947 unique instances, of which 918 were lost.
 *
 * Two traps this handles:
 *
 *  1. ONLY when the parent has no `rrule`. A genuine series is already
 *     expanded by expandRecurringEvent(), and promoting its overrides on top
 *     would duplicate them.
 *  2. node-ical keys `recurrences` under BOTH a date-only string and a full
 *     ISO string, so the map has ~2 entries per real instance. Deduping on
 *     start instant is required, and the parent is itself an instance - so
 *     the seen-set is seeded with the parent's own start or it double-counts.
 */
function promoteOrphans (parent, from, to) {
  const seen = new Set();
  const out = [];

  const add = (ev, isRecurring) => {
    if (!ev || !ev.start) return;
    const t = ev.start.getTime();
    if (seen.has(t)) return;
    seen.add(t);
    const end = ev.end || ev.start;
    if (!overlaps(ev.start, end, from, to)) return;
    out.push({
      event: ev,
      start: ev.start,
      end: end,
      isRecurring: isRecurring,
      isFullDay: isAllDay(ev)
    });
  };

  add(parent, false);                                   // the parent is an instance too
  for (const rec of Object.values(parent.recurrences)) add(rec, true);
  return out;
}

/**
 * Expand every VEVENT in a parsed calendar into concrete instances.
 *
 * @param {object} data parsed node-ical output
 * @param {Date} from window start
 * @param {Date} to window end
 * @returns {object[]} instances shaped { event, start, end, isRecurring, isFullDay }
 *                     - the same shape node-ical's expandRecurringEvent returns
 */
function expandEvents (data, from, to) {
  const out = [];
  let orphanParents = 0, promoted = 0;

  for (const ev of Object.values(data)) {
    if (!ev || ev.type !== "VEVENT") continue;

    if (ev.recurrences && !ev.rrule) {
      orphanParents++;
      const inst = promoteOrphans(ev, from, to);
      promoted += inst.length;
      out.push(...inst);
      continue;
    }

    let inst;
    try {
      inst = ical.expandRecurringEvent(ev, Object.assign({ from: from, to: to }, EXPAND_OPTS));
    } catch (e) {
      continue;                                         // one bad event must not kill a feed
    }
    for (const i of inst) {
      const end = i.end || i.start;
      if (!overlaps(i.start, end, from, to)) continue;
      out.push({
        event: i.event || ev,
        start: i.start,
        end: end,
        isRecurring: !!i.isRecurring,
        isFullDay: typeof i.isFullDay === "boolean" ? i.isFullDay : isAllDay(i.event || ev)
      });
    }
  }

  out.sort((a, b) => a.start - b.start);
  out.stats = { orphanParents: orphanParents, promoted: promoted };
  return out;
}

module.exports = { expandEvents, promoteOrphans, isAllDay, overlaps };
