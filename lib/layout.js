/**
 * MMM-MultiDayGrid - layout engine.
 *
 * Pure: wire events in, positioned tiles and chips out. No DOM, no globals,
 * no MagicMirror. Text measurement is injected, so the same code runs in a
 * browser (canvas) and in a test (a stub).
 *
 * Positions are emitted as PERCENTAGES of the column, not pixels, so the CSS
 * never has to agree with the JS about the board's size.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.MMDGLayout = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const HOUR = 3600000;
  const DAY = 86400000;

  function dateKey (d) {
    const p = (n) => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }

  /** The `days` visible columns, each with its own visible time window. */
  function buildColumns (cfg, now) {
    const cols = [];
    const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    base.setDate(base.getDate() + (cfg.dayIndex || 0));
    for (let i = 0; i < cfg.days; i++) {
      const d = new Date(base);
      d.setDate(d.getDate() + i);
      const from = new Date(d); from.setHours(cfg.beginHour, 0, 0, 0);
      const to = new Date(from.getTime() + cfg.hourLength * HOUR);
      cols.push({
        index: i,
        date: dateKey(d),
        weekday: d.getDay(),
        dayNumber: d.getDate(),
        isToday: dateKey(d) === dateKey(now),
        isWeekend: d.getDay() === 0 || d.getDay() === 6,
        from: from.getTime(),
        to: to.getTime()
      });
    }
    return cols;
  }

  /**
   * Max-min fair share.
   *
   * Satisfy every small demand exactly, then split what remains equally among
   * the rest. Proportional-to-demand is the obvious alternative and it is
   * WRONG: one very long title starves its neighbour, making a tile that
   * already fitted NARROWER than it was before. Do not revisit.
   */
  function fairShare (demands, budget) {
    const n = demands.length;
    const order = demands.map((_, i) => i).sort((a, b) => demands[a] - demands[b]);
    const out = new Array(n).fill(0);
    let left = budget;
    for (let k = 0; k < n; k++) {
      const i = order[k];
      const share = left / (n - k);
      if (demands[i] <= share) { out[i] = demands[i]; left -= demands[i]; }
      else { for (let j = k; j < n; j++) out[order[j]] = share; left = 0; break; }
    }
    if (left > 0.5) {                       // every demand met - spread the slack
      const tot = out.reduce((a, b) => a + b, 0);
      if (tot > 0) for (let i = 0; i < n; i++) out[i] += left * (out[i] / tot);
    }
    return out;
  }

  /** Connected overlap groups: segments chained by any overlap, in order. */
  function groupOverlaps (segs) {
    const sorted = segs.slice().sort((a, b) => a.start - b.start || a.end - b.end);
    const groups = [];
    let cur = [], reach = -Infinity;
    for (const s of sorted) {
      if (cur.length && s.start >= reach) { groups.push(cur); cur = []; reach = -Infinity; }
      cur.push(s);
      reach = Math.max(reach, s.end);
    }
    if (cur.length) groups.push(cur);
    return groups;
  }

  /** Lowest free lane, so a group of non-overlapping events collapses to one lane. */
  function assignLanes (group) {
    const laneEnds = [];
    for (const s of group) {
      let lane = laneEnds.findIndex((e) => e <= s.start);
      if (lane === -1) { lane = laneEnds.length; laneEnds.push(0); }
      laneEnds[lane] = s.end;
      s.lane = lane;
    }
    const lanes = laneEnds.length;
    for (const s of group) s.lanes = lanes;
    return lanes;
  }

  /**
   * Chips pack into rows so two spans that share a day never collide, and a
   * multi-day event stays ONE bar across its columns rather than repeating.
   */
  function packChips (events, cols) {
    const first = cols[0].date, lastCol = cols[cols.length - 1];
    const chips = [];
    for (const e of events) {
      if (!e.allDay) continue;
      if (e.endDate <= first || e.startDate > lastCol.date) continue;
      let s = cols.findIndex((c) => c.date >= e.startDate);
      if (s === -1) continue;
      let idx = cols.findIndex((c) => c.date >= e.endDate);
      const end = idx === -1 ? cols.length : idx;      // endDate is EXCLUSIVE
      if (end <= s) continue;
      chips.push({
        event: e,
        colStart: s,
        colEnd: end,
        span: end - s,
        continuesBefore: e.startDate < cols[0].date,
        continuesAfter: e.endDate > lastCol.date,
        row: 0
      });
    }
    chips.sort((a, b) => a.colStart - b.colStart || b.span - a.span);
    const rows = [];
    for (const c of chips) {
      let r = 0;
      while (rows[r] && rows[r].some((o) => c.colStart < o.colEnd && o.colStart < c.colEnd)) r++;
      (rows[r] = rows[r] || []).push(c);
      c.row = r;
    }
    return { chips, rowCount: rows.length };
  }

  /**
   * @param {object[]} events wire events
   * @param {object} cfg      days, dayIndex, beginHour, hourLength, columnWidth,
   *                          minTileWidth, tilePadding, now
   * @param {function} measure (text) -> px. Omit and every tile demands the floor.
   */
  function layout (events, cfg, measure) {
    const now = cfg.now instanceof Date ? cfg.now : new Date();
    const cols = buildColumns(cfg, now);
    const nowMs = now.getTime();
    const pad = cfg.tilePadding == null ? 12 : cfg.tilePadding;
    const floor = cfg.minTileWidth || 54;
    const colW = cfg.columnWidth || 378;

    const { chips, rowCount } = packChips(events, cols);

    // Split timed events per column. A multi-day event becomes one segment in
    // each column it touches, clipped to that column's visible hours, so it
    // gets continuation borders instead of vanishing or overflowing.
    const tiles = [];
    for (const col of cols) {
      const segs = [];
      for (const e of events) {
        if (e.allDay) continue;
        const s = Math.max(e.start, col.from);
        const en = Math.min(e.end, col.to);
        if (en <= s) continue;
        segs.push({
          event: e, start: s, end: en,
          continuesBefore: e.start < col.from,
          continuesAfter: e.end > col.to,
          passed: e.end <= nowMs
        });
      }
      const span = col.to - col.from;
      for (const group of groupOverlaps(segs)) {
        assignLanes(group);
        const lanes = group[0].lanes;
        const demand = new Array(lanes).fill(floor);
        for (const s of group) {
          const w = measure ? Math.ceil(measure(s.event.title)) + pad : floor;
          demand[s.lane] = Math.max(demand[s.lane], Math.max(floor, w));
        }
        const widths = fairShare(demand, colW);
        const edges = [0];
        widths.forEach((w) => edges.push(edges[edges.length - 1] + w));
        for (const s of group) {
          tiles.push({
            event: s.event,
            column: col.index,
            top: ((s.start - col.from) / span) * 100,
            height: ((s.end - s.start) / span) * 100,
            left: (edges[s.lane] / colW) * 100,
            width: (widths[s.lane] / colW) * 100,
            widthPx: widths[s.lane],
            lane: s.lane,
            lanes: lanes,
            passed: s.passed,
            continuesBefore: s.continuesBefore,
            continuesAfter: s.continuesAfter
          });
        }
      }
    }

    let nowLine = null;
    const todayCol = cols.find((c) => c.isToday);
    if (todayCol && nowMs >= todayCol.from && nowMs <= todayCol.to) {
      nowLine = {
        column: todayCol.index,
        top: ((nowMs - todayCol.from) / (todayCol.to - todayCol.from)) * 100
      };
    }

    return { columns: cols, chips, chipRows: rowCount, tiles, nowLine };
  }

  return { layout, fairShare, groupOverlaps, assignLanes, packChips, buildColumns };
});
