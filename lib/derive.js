/**
 * MMM-MultiDayGrid - layout derivation.
 *
 * `days`, `width` and `height` are the inputs. Everything else about the grid's
 * geometry is computed here. Those four values used to be configured by hand
 * (baseFontSize, indexWidth, minTileWidth, narrowTileWidth) and they are
 * COUPLED - setting them independently is how they drift out of agreement with
 * each other and with the board they sit in.
 *
 * Pure and dependency-free: usable from node_helper (require) and from the
 * browser (window.MMDGDerive). No DOM access.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.MMDGDerive = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* ------------------------------------------------------------------
   * Empirical constants.
   *
   * Measured from the reference board on 2026-08-22 (dev/local-baseline.json):
   * a 1196x800 board at days:3 / hourLength:16 renders baseFontPx 34,
   * columnW 378, indexWidth 62px. Every ratio below is derived from that
   * measurement, so `derive()` reproduces the real board rather than
   * approximating it. Re-measure before changing any of them.
   * ---------------------------------------------------------------- */
  var ROW_FONT    = 1.36;   // baseFontSize / rowHeight     (34 / 25)
  var COL_FONT    = 0.09;   // baseFontSize / columnWidth   (34 / 378)
  var INDEX_EM    = 1.82;   // indexWidth   / baseFontSize  (62 / 34)
  var MIN_TILE_EM = 1.59;   // minTileWidth / baseFontSize  (54 / 34)
  var CHROME_PX   = 64;     // day header + all-day chip bar, outside the rows
  var MAX_DAYS    = 4;

  function isNum (v) { return typeof v === "number" && isFinite(v); }
  function r2 (v) { return Math.round(v * 100) / 100; }

  /**
   * Font size the width can support, accounting for the fact that the hour
   * axis itself scales with the font. Solving the circular dependency:
   *
   *   columnWidth = (width - INDEX_EM * F) / days
   *   F           = columnWidth * COL_FONT
   *   =>  F * (days + COL_FONT * INDEX_EM) = COL_FONT * width
   */
  function fontFromWidth (width, days) {
    return (COL_FONT * width) / (days + COL_FONT * INDEX_EM);
  }

  /** Narrowest board that keeps the font at or above `minFontSize`. */
  function minWidthFor (days, minFontSize) {
    return Math.ceil((minFontSize * (days + COL_FONT * INDEX_EM)) / COL_FONT);
  }

  /** Shortest board that keeps the font at or above `minFontSize`. */
  function minHeightFor (hourLength, minFontSize) {
    return Math.ceil(hourLength * 2 * (minFontSize / ROW_FONT) + CHROME_PX);
  }

  /**
   * @param {object} cfg
   *   width, height        required, in px
   *   days                 1..4 (clamped, with a warning)
   *   hourLength           default 16
   *   fontScale            default 1
   *   minFontSize          default 14
   *   baseFontSize         number to override, else "auto"
   *   indexWidth           number to override, else "auto"
   *   minTileWidth         number to override, else "auto"
   *   measureIndexLabel    optional fn(fontPx) -> px; the browser passes a
   *                        canvas measurement of the widest rendered hour
   *                        label so the axis fits the actual format in use.
   */
  function derive (cfg) {
    cfg = cfg || {};
    var warnings = [];

    var days = Math.round(cfg.days);
    if (!isNum(days) || days < 1) {
      warnings.push("days must be a number >= 1; using 1");
      days = 1;
    }
    if (days > MAX_DAYS) {
      warnings.push("days capped at " + MAX_DAYS + " (requested " + cfg.days + ")");
      days = MAX_DAYS;
    }

    var hourLength = isNum(cfg.hourLength) ? cfg.hourLength : 16;
    var rows       = hourLength * 2;
    var width      = cfg.width;
    var height     = cfg.height;
    var fontScale  = isNum(cfg.fontScale) ? cfg.fontScale : 1;
    var minFont    = isNum(cfg.minFontSize) ? cfg.minFontSize : 14;

    var rowHeight = height / rows;

    // Two independent constraints; the smaller wins.
    var fVert = rowHeight * ROW_FONT;          // a 30-min event fits one line
    var fHoriz = fontFromWidth(width, days);   // a column holds a readable title
    var boundBy = fVert <= fHoriz ? "vertical" : "horizontal";
    var base = Math.min(fVert, fHoriz) * fontScale;

    if (isNum(cfg.baseFontSize)) {
      base = cfg.baseFontSize;
      boundBy = "override";
    }

    // Undersize is reported, never silently corrected - the caller decides
    // via `onUndersize`.
    var undersize = base < minFont;
    if (undersize) base = minFont;

    var indexWidth = isNum(cfg.indexWidth) ? cfg.indexWidth
      : (typeof cfg.measureIndexLabel === "function"
          ? cfg.measureIndexLabel(base)
          : INDEX_EM * base);

    var columnWidth  = (width - indexWidth) / days;
    var minTileWidth = isNum(cfg.minTileWidth) ? cfg.minTileWidth : MIN_TILE_EM * base;

    return {
      days: days,
      hourLength: hourLength,
      rows: rows,
      rowHeight: r2(rowHeight),
      baseFontSize: r2(base),
      indexWidth: r2(indexWidth),
      columnWidth: r2(columnWidth),
      minTileWidth: r2(minTileWidth),
      maxLanes: Math.floor(columnWidth / minTileWidth),
      boundBy: boundBy,
      undersize: undersize,
      minWidth: minWidthFor(days, minFont),
      minHeight: minHeightFor(hourLength, minFont),
      warnings: warnings
    };
  }

  derive.derive = derive;
  derive.minWidthFor = minWidthFor;
  derive.minHeightFor = minHeightFor;
  derive.constants = {
    ROW_FONT: ROW_FONT, COL_FONT: COL_FONT, INDEX_EM: INDEX_EM,
    MIN_TILE_EM: MIN_TILE_EM, CHROME_PX: CHROME_PX, MAX_DAYS: MAX_DAYS
  };
  return derive;
});
