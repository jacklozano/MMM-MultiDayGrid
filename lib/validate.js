/**
 * MMM-MultiDayGrid - configuration validation.
 *
 * Classifies problems into FATAL and PARTIAL, because those get different
 * treatment on screen (README "Behaviour contract"):
 *
 *   fatal   -> render an error panel listing every problem, draw no grid.
 *              Reserved for states where a grid would be actively misleading.
 *   partial -> skip just the offending calendar, render everything else, and
 *              name it in the corner note.
 *
 * A silently-dropped calendar is the failure mode this whole module exists to
 * escape, so nothing is ever discarded without being reported.
 */
"use strict";

const MAX_CALENDARS = 8;
const WARN_CALENDARS = 6;
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const NAMED = /^[a-z]+$/i;

function isNum (v) { return typeof v === "number" && isFinite(v); }

function validate (config) {
  config = config || {};
  const fatal = [];
  const problems = [];
  const calendars = [];

  for (const [key, min, max] of [["days", 1, 4], ["hourLength", 1, 24], ["beginHour", 0, 23]]) {
    if (config[key] !== undefined && !isNum(config[key])) {
      fatal.push(`${key} must be a number (got ${JSON.stringify(config[key])})`);
    } else if (isNum(config[key]) && (config[key] < min || config[key] > max)) {
      problems.push(`${key} ${config[key]} is outside ${min}-${max}; it will be clamped`);
    }
  }

  const list = config.calendars;
  if (!Array.isArray(list) || list.length === 0) {
    fatal.push("calendars must be a non-empty array");
    return { fatal, problems, calendars };
  }

  const seen = new Set();
  for (let i = 0; i < list.length; i++) {
    const c = list[i] || {};
    const label = c.name ? `"${c.name}"` : `calendars[${i}]`;

    if (c.hidden === true) continue;                       // deliberate, not a problem

    if (typeof c.url !== "string" || !/^https?:\/\//i.test(c.url)) {
      problems.push(`${label} skipped: url must be an http(s) iCal address`);
      continue;
    }
    if (typeof c.name !== "string" || !c.name.trim()) {
      problems.push(`calendars[${i}] skipped: name is required`);
      continue;
    }
    if (seen.has(c.name)) {
      problems.push(`${label} skipped: duplicate name`);
      continue;
    }
    seen.add(c.name);

    let color = c.color;
    if (typeof color !== "string" || !(HEX.test(color) || NAMED.test(color))) {
      problems.push(`${label}: colour ${JSON.stringify(color)} is not usable; using grey`);
      color = "#888888";
    }

    if (calendars.length >= MAX_CALENDARS) {
      problems.push(`${label} dropped: more than ${MAX_CALENDARS} calendars configured`);
      continue;
    }

    calendars.push({
      name: c.name,
      url: c.url,
      color: color,
      exclude: Array.isArray(c.exclude) ? c.exclude : [],
      fetchInterval: isNum(c.fetchInterval) ? c.fetchInterval : null
    });
  }

  if (calendars.length === 0) fatal.push("no usable calendars after validation");
  if (calendars.length > WARN_CALENDARS) {
    problems.push(`${calendars.length} calendars configured; past ${WARN_CALENDARS} the tinted `
      + "colours stop being reliably distinguishable");
  }

  return { fatal, problems, calendars };
}

module.exports = { validate, MAX_CALENDARS, WARN_CALENDARS };
