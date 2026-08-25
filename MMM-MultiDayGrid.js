/* global Module, Log, MMDGDerive, MMDGLayout, MMDGGrid */

/**
 * MMM-MultiDayGrid - MagicMirror front-end.
 *
 * Thin by design: fetching lives in node_helper, geometry in lib/derive.js,
 * placement in lib/layout.js, DOM in lib/grid.js. This file is wiring.
 *
 * THE ONE SUBTLE THING is when the board is measured. getDom() returns a
 * DETACHED node, so getBoundingClientRect() there returns 0 and every derived
 * size collapses. The previous implementation's width patch failed exactly
 * this way - twice - reporting success while sizing nothing. So getDom()
 * returns an empty, correctly-sized shell and the real paint happens once the
 * element is attached and has a width.
 */
Module.register("MMM-MultiDayGrid", {

  defaults: {
    calendars: [],

    days: 3,
    dayIndex: 0,
    beginHour: 6,
    hourLength: 16,
    staticTime: true,

    width: "100%",
    height: "800px",

    fontScale: 1.0,
    eventTint: 0.58,
    inkColor: "#14161a",
    showHalfHourLines: false,
    todayStyle: "ring",
    todayTint: 0.06,
    neutralWeekends: true,
    passedOpacity: 0.4,
    allDayThresholdHours: 23,
    maxChipRows: 4,

    fetchInterval: 900000,
    fetchTimeout: 90000,
    staleAfterMinutes: 90,
    includePastEvents: true,
    hidePrivate: true,

    dateHeaderOptions: { weekday: "short", day: "numeric" },
    hourIndexOptions: { hour: "numeric" },
    eventTimeOptions: { hour: "numeric", minute: "2-digit" },

    baseFontSize: "auto",
    indexWidth: "auto",
    minTileWidth: "auto",
    minFontSize: 14,
    onUndersize: "reduceDays",

    tilePadding: 12,
    fontFamily: "Helvetica Neue, Helvetica, sans-serif",
    repaintInterval: 60000        // moves the now-line; no refetch
  },

  getStyles () { return [this.file("MMM-MultiDayGrid.css")]; },

  getScripts () {
    return [
      this.file("lib/derive.js"),
      this.file("lib/layout.js"),
      this.file("lib/grid.js")
    ];
  },

  start () {
    this.events = null;             // null = nothing received yet -> skeleton
    this.feeds = [];
    this.problems = [];
    this.fatal = null;
    this.painted = false;
    this.sendSocketNotification("MMDG_CONFIG", this.config);
    this.timer = setInterval(() => this.paint(), this.config.repaintInterval);
  },

  suspend () { if (this.timer) { clearInterval(this.timer); this.timer = null; } },
  resume () {
    if (!this.timer) this.timer = setInterval(() => this.paint(), this.config.repaintInterval);
    this.paint();
  },

  socketNotificationReceived (notification, payload) {
    if (notification === "MMDG_EVENTS") this.events = payload.events;
    else if (notification === "MMDG_STATUS") { this.feeds = payload.feeds; this.problems = payload.problems; }
    else if (notification === "MMDG_FATAL") this.fatal = payload.problems;
    else return;
    this.paint();
  },

  notificationReceived (notification) {
    // Fires once the module's element is in the document and has a real width.
    if (notification === "MODULE_DOM_CREATED") this.paint();
  },

  getDom () {
    if (!this.shell) {
      this.shell = document.createElement("div");
      this.shell.className = "mmdg-shell";
    }
    // Size the shell from config so it has a width the moment it attaches -
    // everything below measures THIS, never a detached node.
    this.shell.style.width = this.config.width;
    this.shell.style.height = this.config.height;
    return this.shell;
  },

  /** Widest hour label actually rendered, so the axis fits the configured format. */
  measureIndexLabel (fontPx) {
    if (!this._ctx) this._ctx = document.createElement("canvas").getContext("2d");
    this._ctx.font = (fontPx * 0.5).toFixed(2) + "px " + this.config.fontFamily;
    let w = 0;
    for (let h = 0; h < this.config.hourLength; h++) {
      const t = new Date(2000, 0, 1, this.config.beginHour + h, 0, 0);
      let s = "";
      try { s = new Intl.DateTimeFormat(undefined, this.config.hourIndexOptions).format(t); } catch (e) { s = ""; }
      w = Math.max(w, this._ctx.measureText(s).width);
    }
    return Math.ceil(w) + Math.ceil(fontPx * 0.2);      // + breathing room
  },

  paint () {
    if (!this.shell || !this.shell.isConnected) return;

    const rect = this.shell.getBoundingClientRect();
    if (!(rect.width > 0 && rect.height > 0)) return;   // not laid out yet

    if (this.fatal) return this.renderFatal();

    let days = this.config.days;
    let d = MMDGDerive({
      width: rect.width, height: rect.height, days: days,
      hourLength: this.config.hourLength, fontScale: this.config.fontScale,
      minFontSize: this.config.minFontSize,
      baseFontSize: this.config.baseFontSize === "auto" ? undefined : this.config.baseFontSize,
      indexWidth: this.config.indexWidth === "auto" ? undefined : this.config.indexWidth,
      minTileWidth: this.config.minTileWidth === "auto" ? undefined : this.config.minTileWidth,
      measureIndexLabel: (f) => this.measureIndexLabel(f)
    });

    // Too small for the configured day count: shed days until it fits, or say so.
    if (d.undersize) {
      if (this.config.onUndersize === "reduceDays") {
        while (days > 1 && d.undersize) {
          days--;
          d = MMDGDerive({ width: rect.width, height: rect.height, days: days,
            hourLength: this.config.hourLength, fontScale: this.config.fontScale,
            minFontSize: this.config.minFontSize,
            measureIndexLabel: (f) => this.measureIndexLabel(f) });
        }
        if (!this._warnedUndersize) {
          Log.warn(`MMM-MultiDayGrid: board is ${Math.round(rect.width)}x${Math.round(rect.height)}; `
            + `days reduced ${this.config.days} -> ${days} (needs ${d.minWidth}x${d.minHeight})`);
          this._warnedUndersize = true;
        }
      } else if (this.config.onUndersize === "error") {
        return this.renderFatal([`board is ${Math.round(rect.width)}x${Math.round(rect.height)}; `
          + `days:${this.config.days} needs at least ${d.minWidth}x${d.minHeight}`]);
      }
    }

    if (!this.events) return this.renderSkeleton(d, days);

    if (!this._titleCtx) this._titleCtx = document.createElement("canvas").getContext("2d");
    this._titleCtx.font = "500 " + (d.baseFontSize * 0.46 * 1.15).toFixed(2) + "px " + this.config.fontFamily;
    const measure = (t) => this._titleCtx.measureText(String(t == null ? "" : t)).width;

    const layout = MMDGLayout.layout(this.events, Object.assign({}, this.config, {
      days: days, columnWidth: d.columnWidth, minTileWidth: d.minTileWidth, now: new Date()
    }), measure);

    this.swap(MMDGGrid.buildGrid({
      layout: layout, derived: d,
      config: Object.assign({}, this.config, { days: days, width: null, height: null }),
      feeds: this.feeds, problems: this.problems
    }));
  },

  renderSkeleton (d, days) {
    const layout = MMDGLayout.layout([], Object.assign({}, this.config, {
      days: days, columnWidth: d.columnWidth, minTileWidth: d.minTileWidth, now: new Date()
    }));
    this.swap(MMDGGrid.buildSkeleton({
      layout: layout, derived: d,
      config: Object.assign({}, this.config, { days: days, width: null, height: null }),
      feeds: this.feeds, problems: this.problems
    }));
  },

  renderFatal (problems) {
    const box = document.createElement("div");
    box.className = "mmdg-error";
    box.appendChild(document.createTextNode("MMM-MultiDayGrid cannot render:"));
    const ul = document.createElement("ul");
    for (const p of (problems || this.fatal || [])) {
      const li = document.createElement("li");
      li.textContent = p;
      ul.appendChild(li);
    }
    box.appendChild(ul);
    this.swap(box);
  },

  swap (node) {
    while (this.shell.firstChild) this.shell.removeChild(this.shell.firstChild);
    this.shell.appendChild(node);
    this.painted = true;
  }
});
