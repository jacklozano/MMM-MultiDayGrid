/**
 * MMM-MultiDayGrid - node helper.
 *
 * Owns fetch scheduling and pushes wire events to the front-end.
 *
 * Emits ON CHANGE ONLY. This is not an optimisation: MagicMirror's built-in
 * calendar module broadcasts its full event list after EVERY completed fetch
 * of EVERY calendar, whether or not anything changed - roughly 24 times an
 * hour for six feeds on a 15-minute interval. A renderer that relaid out on
 * each of those would do ~24 full layout passes an hour for nothing. Hashing
 * the normalized payload and staying quiet when it is unchanged keeps the
 * work proportional to actual changes.
 */
"use strict";

const NodeHelper = require("node_helper");
const crypto = require("crypto");
const { validate } = require("./lib/validate.js");
const { fetchOne } = require("./lib/fetch.js");

module.exports = NodeHelper.create({
  start () {
    this.config = null;
    this.timers = new Map();
    this.feeds = new Map();          // name -> { ok, fetchedAt, error, events }
    this.lastHash = null;
    this.instanceId = null;
  },

  socketNotificationReceived (notification, payload) {
    if (notification !== "MMDG_CONFIG") return;

    const id = payload && payload.identifier;
    const config = (payload && payload.config) || payload;

    // node_helper is server-side and OUTLIVES the browser page. Every reload -
    // a kiosk restart, MMM-auto-refresh's 15-minute cycle - re-runs the
    // front-end's start() and re-sends the config. Counting messages would
    // therefore flag a "second instance" on the first reload, forever.
    // Identity is what distinguishes them: MagicMirror derives `identifier`
    // from the module's position in config, so it is stable across reloads and
    // genuinely different for a second instance.
    if (this.instanceId && id && this.instanceId !== id) {
      this.sendSocketNotification("MMDG_FATAL", {
        problems: ["a second MMM-MultiDayGrid instance is configured; only one is supported"]
      });
      return;
    }

    if (this.instanceId && this.instanceId === id) {
      // Same instance reconnecting after a page reload. The browser lost its
      // events; we still have them. Re-publish immediately rather than leaving
      // a skeleton on screen until the next scheduled fetch.
      this.lastHash = null;
      this.publish();
      return;
    }

    this.instanceId = id || "unknown";
    this.configure(config);
  },

  configure (config) {
    const v = validate(config);
    if (v.fatal.length) {
      this.sendSocketNotification("MMDG_FATAL", { problems: v.fatal.concat(v.problems) });
      return;
    }
    this.config = config;
    this.problems = v.problems;      // partial issues -> corner note, grid still renders

    for (const cal of v.calendars) {
      const every = cal.fetchInterval || config.fetchInterval || 900000;
      this.refresh(cal);
      this.timers.set(cal.name, setInterval(() => this.refresh(cal), every));
    }
  },

  async refresh (cal) {
    const result = await fetchOne(cal, this.config, new Date());
    const prev = this.feeds.get(cal.name);

    // A failed refresh keeps the last good events. Losing a day's calendar
    // because one request timed out is worse than showing slightly old data;
    // the front-end names the feed in the corner note once it goes stale.
    if (!result.ok && prev && prev.events.length) {
      this.feeds.set(cal.name, Object.assign({}, prev, { error: result.error }));
    } else {
      this.feeds.set(cal.name, result);
    }
    this.publish();
  },

  publish () {
    const events = [];
    const feeds = [];
    for (const [name, f] of this.feeds) {
      events.push(...f.events);
      feeds.push({ name, ok: !!f.ok, fetchedAt: f.fetchedAt || null, error: f.error || null });
    }

    const hash = crypto.createHash("sha1")
      .update(JSON.stringify(events))
      .digest("hex");

    // Feed health always goes out - staleness must surface even when the
    // event set is unchanged - but the payload is only rebuilt on change.
    this.sendSocketNotification("MMDG_STATUS", { feeds, problems: this.problems || [] });
    if (hash === this.lastHash) return;
    this.lastHash = hash;
    this.sendSocketNotification("MMDG_EVENTS", { events });
  },

  stop () {
    for (const t of this.timers.values()) clearInterval(t);
    this.timers.clear();
  }
});
