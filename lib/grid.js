/**
 * MMM-MultiDayGrid - DOM rendering.
 *
 * Consumes layout() output and emits elements. Deliberately dumb: every
 * position is already a percentage, so this module never computes geometry
 * and the CSS never needs to agree with the JS about the board's pixel size.
 *
 * NO MAGIC NUMBERS. Every size comes from derive() or config - the old
 * implementation's 62 / 130 / 54 literals are exactly what this replaces.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.MMDGGrid = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  /**
   * Canvas text measurement. No reflow, and independent of the width we are
   * about to assign - measuring a live element would be circular.
   */
  function makeMeasurer (doc, fontSpec) {
    const ctx = doc.createElement("canvas").getContext("2d");
    ctx.font = fontSpec;
    return (text) => ctx.measureText(String(text == null ? "" : text)).width;
  }

  function el (doc, tag, cls, text) {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function fmt (ms, opts, locale) {
    try { return new Intl.DateTimeFormat(locale || undefined, opts).format(new Date(ms)); }
    catch (e) { return ""; }
  }

  /**
   * @param {object} o
   *   layout    output of layout()
   *   derived   output of derive()
   *   config    module config
   *   feeds     [{name, ok, fetchedAt, error}] for the corner note
   *   problems  config problems for the corner note
   *   doc       document (injectable for tests)
   */
  function buildGrid (o) {
    const doc = o.doc || document;
    const L = o.layout, D = o.derived, cfg = o.config || {};
    const root = el(doc, "div", "mmdg");

    // The single knob everything else is an em multiple of.
    root.style.fontSize = D.baseFontSize + "px";
    root.style.setProperty("--index-width", D.indexWidth + "px");
    root.style.setProperty("--days", L.columns.length);
    root.style.setProperty("--rows", cfg.hourLength * 2);
    root.style.setProperty("--tint", (cfg.eventTint == null ? 0.58 : cfg.eventTint) * 100 + "%");
    root.style.setProperty("--ink", cfg.inkColor || "#14161a");
    root.style.setProperty("--passed-opacity", cfg.passedOpacity == null ? 0.4 : cfg.passedOpacity);
    // Today's column gets a lifted background rather than a coloured one, so it
    // reads as "here" without adding a hue that competes with the calendar
    // colours. Expressed as white-over-black so it stays correct if the board
    // background ever changes.
    root.style.setProperty("--today-tint",
      ((cfg.todayTint == null ? 0.06 : cfg.todayTint) * 100).toFixed(2) + "%");
    if (cfg.width) root.style.width = cfg.width;
    if (cfg.height) root.style.height = cfg.height;

    const board = el(doc, "div", "mmdg-board");
    root.appendChild(board);

    /* ---- header: day names + all-day chips -------------------------------- */
    const header = el(doc, "div", "mmdg-header");
    header.appendChild(el(doc, "div", "mmdg-corner"));
    const days = el(doc, "div", "mmdg-days");
    for (const c of L.columns) {
      const d = el(doc, "div", "mmdg-day"
        + (c.isToday ? " is-today" : "")
        + (c.isWeekend && cfg.neutralWeekends === false ? " is-weekend" : ""));
      d.appendChild(el(doc, "div", "mmdg-weekday", WEEKDAY[c.weekday].toUpperCase()));
      const num = el(doc, "div", "mmdg-daynum", String(c.dayNumber));
      if (c.isToday && (cfg.todayStyle || "ring") !== "none") num.classList.add("style-" + (cfg.todayStyle || "ring"));
      d.appendChild(num);
      days.appendChild(d);
    }
    header.appendChild(days);
    board.appendChild(header);

    /* ---- all-day chip bar --------------------------------------------------
     * Sized to its content up to maxChipRows. Past that a "+N" marker is
     * shown - the implementation this replaces silently dropped a 4th chip,
     * which is invisible and therefore the worst possible behaviour.        */
    const maxRows = cfg.maxChipRows == null ? 4 : cfg.maxChipRows;
    const shown = L.chips.filter((c) => c.row < maxRows);
    const hidden = L.chips.length - shown.length;
    if (L.chips.length) {
      const bar = el(doc, "div", "mmdg-chipbar");
      bar.style.setProperty("--chip-rows", Math.min(L.chipRows, maxRows));
      bar.appendChild(el(doc, "div", "mmdg-corner"));
      const area = el(doc, "div", "mmdg-chips");
      // Backdrop so today's tint runs unbroken from the day header, through
      // the chip bar, to the bottom of the grid.
      const todayIdx = L.columns.findIndex((c) => c.isToday);
      if (todayIdx !== -1) {
        const back = el(doc, "div", "mmdg-chip-today");
        back.style.setProperty("--col", todayIdx + 1);
        area.appendChild(back);
      }
      for (const c of shown) {
        const chip = el(doc, "div", "mmdg-chip"
          + (c.continuesBefore ? " continues-before" : "")
          + (c.continuesAfter ? " continues-after" : ""));
        chip.style.setProperty("--col-start", c.colStart + 1);
        chip.style.setProperty("--col-end", c.colEnd + 1);
        chip.style.setProperty("--row", c.row + 1);
        chip.style.setProperty("--cal", c.event.color);
        chip.appendChild(el(doc, "span", "mmdg-chip-title", c.event.title));
        area.appendChild(chip);
      }
      if (hidden > 0) {
        const more = el(doc, "div", "mmdg-chip-more", "+" + hidden);
        more.style.setProperty("--row", maxRows);
        area.appendChild(more);
      }
      bar.appendChild(area);
      board.appendChild(bar);
    }

    /* ---- body: hour axis + columns ---------------------------------------- */
    const body = el(doc, "div", "mmdg-body");
    const axis = el(doc, "div", "mmdg-axis");
    for (let h = 0; h < cfg.hourLength; h++) {
      const t = new Date(2000, 0, 1, cfg.beginHour + h, 0, 0).getTime();
      const lab = el(doc, "div", "mmdg-hour", fmt(t, cfg.hourIndexOptions || { hour: "numeric" }, cfg.locale));
      lab.style.setProperty("--h", h);
      axis.appendChild(lab);
    }
    body.appendChild(axis);

    const gridEl = el(doc, "div", "mmdg-grid");
    for (const c of L.columns) {
      const col = el(doc, "div", "mmdg-col" + (c.isToday ? " is-today" : ""));
      col.style.setProperty("--col", c.index + 1);
      gridEl.appendChild(col);
    }

    // Per-tile time suppression: measure THIS tile's time string and render it
    // only if it fits. No global threshold, so it cannot go stale when the
    // font changes.
    const timeFont = (cfg.timeFontSpec)
      || ("500 " + (D.baseFontSize * 0.46 * 0.85).toFixed(2) + "px " + (cfg.fontFamily || "sans-serif"));
    const measureTime = o.measureTime || makeMeasurer(doc, timeFont);
    const pad = cfg.tilePadding == null ? 12 : cfg.tilePadding;

    for (const t of L.tiles) {
      const tile = el(doc, "div", "mmdg-tile"
        + (t.passed ? " is-passed" : "")
        + (t.continuesBefore ? " continues-before" : "")
        + (t.continuesAfter ? " continues-after" : ""));
      tile.style.setProperty("--top", t.top + "%");
      tile.style.setProperty("--height", t.height + "%");
      tile.style.setProperty("--left", t.left + "%");
      tile.style.setProperty("--width", t.width + "%");
      tile.style.setProperty("--cal", t.event.color);
      tile.appendChild(el(doc, "div", "mmdg-title", t.event.title));

      // A segment continuing from the previous day starts at the top of this
      // column; printing the original start there reads as though the event
      // begins now. The continuation border already carries that meaning.
      const timeStr = t.continuesBefore ? ""
        : fmt(t.event.start, cfg.eventTimeOptions || { hour: "numeric", minute: "2-digit" }, cfg.locale);
      if (timeStr && measureTime(timeStr) + pad <= t.widthPx) {
        tile.appendChild(el(doc, "div", "mmdg-time", timeStr));
      }
      gridEl.children[t.column].appendChild(tile);
    }

    if (L.nowLine) {
      // Appended INTO the column, not the grid. An absolutely-positioned child
      // of the grid ignores grid-column and stretches across every column.
      const now = el(doc, "div", "mmdg-now");
      now.style.setProperty("--top", L.nowLine.top + "%");
      gridEl.children[L.nowLine.column].appendChild(now);
    }

    body.appendChild(gridEl);
    board.appendChild(body);

    /* ---- corner note ------------------------------------------------------
     * One channel for everything needing attention: stale feeds and skipped
     * config entries. Renders nothing at all when healthy.                  */
    const notes = [];
    const staleAfter = (cfg.staleAfterMinutes == null ? 90 : cfg.staleAfterMinutes) * 60000;
    for (const f of (o.feeds || [])) {
      if (!f.ok && !f.fetchedAt) { notes.push(f.name + " · no data"); continue; }
      if (f.fetchedAt && Date.now() - f.fetchedAt > staleAfter) {
        const mins = Math.round((Date.now() - f.fetchedAt) / 60000);
        notes.push(f.name + " · " + (mins >= 60 ? Math.round(mins / 60) + "h" : mins + "m"));
      }
    }
    for (const p of (o.problems || [])) notes.push(p);
    if (notes.length) board.appendChild(el(doc, "div", "mmdg-note", notes.join("   ")));

    return root;
  }

  function buildSkeleton (o) {
    const doc = o.doc || document;
    const r = buildGrid(Object.assign({}, o, {
      layout: { columns: o.layout.columns, chips: [], chipRows: 0, tiles: [], nowLine: null }
    }));
    r.classList.add("is-loading");
    r.querySelector(".mmdg-grid").appendChild(el(doc, "div", "mmdg-loading", "loading"));
    return r;
  }

  return { buildGrid, buildSkeleton, makeMeasurer };
});
