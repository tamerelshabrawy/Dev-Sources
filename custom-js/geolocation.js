/**
 * geolocation.js — Alexandria Pedestrian Soundwalk
 * Pure geolocation logic: route projection, weighted zone mapping, polygon detection.
 * No UI, no pd4web dependencies — fully testable in isolation.
 *
 * The walk is a RECTANGULAR clockwise loop (~1709 m total) in Alexandria, Egypt.
 * Four sides (from alexandria_pedestrian_route.geojson, right_side feature):
 *
 *   RIGHT   Safeya Zaghloul St  Start (bottom-right) → north → top-right corner
 *           coords 0–22         0 % → 37.2 % of arc  (~635 m, longest side)
 *
 *   TOP     Seafront / Corniche top-right corner → west → top-left corner
 *           coords 22–26        37.2 % → 45.2 % of arc  (~138 m, shortest side)
 *
 *   LEFT    El Naby Danial St   top-left corner → south → bottom-left corner
 *           coords 26–44        45.2 % → 81.1 % of arc  (~613 m)
 *
 *   BOTTOM  El Horeya Road      bottom-left corner → east → back to start
 *           coords 44–51        81.1 % → 100 % of arc  (~323 m)
 *
 * Clockwise direction (as walked):
 *   Start (bottom-right) → NORTH up Safeya Zaghloul → WEST along seafront →
 *   SOUTH down El Naby Danial → EAST along El Horeya → back to start.
 *
 * Zones 1–35 map to the route arc with artistic weighting:
 *   Zones  1– 6  Track 1      start of Safeya Zaghloul going north (~18% of arc)
 *   Zones  7–10  Transition   continuing north up Safeya Zaghloul  (~ 5% of arc)
 *   Zones 11–25  Track 2      upper Safeya Zaghloul + seafront     (~23% of arc)
 *   Zones 26–27  Transition   top-left corner + upper El Naby      (~ 3% of arc)
 *   Zones 28–31  Track 3      El Naby Danial going south           (~17% of arc)
 *   Zones 32–35  Track 4      lower El Naby Danial + El Horeya     (~17% of arc)
 */

/* ─────────────────────────────────────────────────────────────────────────
   ROUTE COORDINATES
   right_side inner route from alexandria_pedestrian_route.geojson
   [longitude, latitude] — clockwise walk order
   Total arc ≈ 1709 m across 4 sides.
   ───────────────────────────────────────────────────────────────────────── */
const ROUTE_LINE = [
    // ── RIGHT: Safeya Zaghloul Street (going north) ──────────────────────
    // Start: bottom-right corner, where El Horeya meets Safeya Zaghloul
    // 0 % → 37.2 % of route arc (~635 m, longest side)
    [29.9042702, 31.1971939],
    [29.9042697, 31.1971939],
    [29.9041345, 31.1974428],
    [29.9039240, 31.1976572],
    [29.9037191, 31.1978710],
    [29.9035805, 31.1980146],
    [29.9034668, 31.1981114],
    [29.9032732, 31.1982327],
    [29.9030305, 31.1984446],
    [29.9029072, 31.1985722],
    [29.9027810, 31.1987394],
    [29.9026791, 31.1988579],
    [29.9025586, 31.1989869],
    [29.9022687, 31.1992511],
    [29.9019591, 31.1995458],
    [29.9019591, 31.1995458],
    [29.9015999, 31.1998636],
    [29.9013854, 31.2000587],
    [29.9011287, 31.2002840],
    [29.9008607, 31.2005171],
    [29.9005950, 31.2007425],
    [29.9003518, 31.2009563],
    [29.8996133, 31.2010997],   // ← top-right corner: Safeya Zaghloul meets seafront

    // ── TOP: Seafront / Corniche (going west) ────────────────────────────
    // 37.2 % → 45.2 % of route arc (shortest side, ~138 m)
    [29.8995806, 31.2014050],   // ← northernmost point of the route
    [29.8992918, 31.2012976],
    [29.8988268, 31.2011214],
    [29.8985785, 31.2010352],   // ← top-left corner: seafront meets El Naby Danial

    // ── LEFT: El Naby Danial Street (going south) ────────────────────────
    // 45.2 % → 81.1 % of route arc (~613 m)
    [29.8988634, 31.2004477],
    [29.8990220, 31.2001435],
    [29.8991065, 31.1999369],
    [29.8993131, 31.1997794],
    [29.8995214, 31.1996210],
    [29.9000878, 31.1984075],
    [29.9002448, 31.1980737],
    [29.9003473, 31.1978637],
    [29.9004363, 31.1976696],
    [29.9005354, 31.1974520],
    [29.9007290, 31.1970330],
    [29.9008214, 31.1968278],
    [29.9009196, 31.1966127],
    [29.9009838, 31.1964567],
    [29.9010204, 31.1963777],
    [29.9010739, 31.1962588],
    [29.9011093, 31.1961634],
    [29.9011600, 31.1960329],   // ← bottom-left corner: El Naby Danial meets El Horeya

    // ── BOTTOM: El Horeya Road (going east) ─────────────────────────────
    // 81.1 % → 100 % of route arc (~323 m)
    [29.9026919, 31.1965935],
    [29.9030252, 31.1967192],
    [29.9032994, 31.1968217],
    [29.9035612, 31.1969195],
    [29.9038177, 31.1970196],
    [29.9040266, 31.1970967],
    [29.9042715, 31.1971886]    // End: back to start (bottom-right corner)
];

/* ─────────────────────────────────────────────────────────────────────────
   OUTER BOUNDARY (left_side from GeoJSON — used for polygon detection)
   ───────────────────────────────────────────────────────────────────────── */
const OUTER_BORDER = [
    [29.8985742,31.2008868],[29.8990142,31.199963],[29.8990518,31.1999074],
    [29.8991099,31.1998557],[29.899243,31.1997604],[29.8994968,31.1995653],
    [29.9002479,31.1980143],[29.9006458,31.1971429],[29.9009235,31.19653],
    [29.9010238,31.1962815],[29.9011116,31.1960526],[29.9011711,31.1959355],
    [29.9023496,31.1963765],[29.9042378,31.1970997],[29.9045246,31.1972019],
    [29.9047666,31.1973246],[29.9035848,31.1982192],[29.9025919,31.1990843],
    [29.902556,31.1991073],[29.9007485,31.200883],[29.9004258,31.2011948],
    [29.9000345,31.2015219],[29.8997148,31.2018949],[29.8987045,31.2014517],
    [29.8982799,31.2012772],[29.898292,31.2010923],[29.8984827,31.2009557],
    [29.8985562,31.2009262],[29.8985764,31.2008867]
];

/**
 * Zone detection polygon: outer boundary + reversed inner route + close.
 * NOTE: kept for reference/backward compatibility only — use nearRoute() for
 * reliable detection. The polygon approach produces incorrect results because
 * OUTER_BORDER and ROUTE_LINE do not share endpoints and create a
 * self-intersecting boundary that defeats ray-casting.
 */
const ZONE_POLYGON = OUTER_BORDER
    .concat(ROUTE_LINE.slice().reverse())
    .concat([OUTER_BORDER[0]]);

/* ─────────────────────────────────────────────────────────────────────────
   ARTISTIC ZONE BREAKPOINTS
   Maps 0→1 route progress to zones 1–35 using weighted segment widths.
   ZONE_BREAKPOINTS[i] is the upper bound (exclusive) of zone i+1.
   Last entry is exactly 1.0 (end of route).

   The four sides of the rectangle and their real arc proportions
   (verified against the GeoJSON, total route ≈ 1709 m):
     RIGHT   Safeya Zaghloul (going north)   0 % →  37.2 %  ~635 m
     TOP     Seafront (going west)          37.2 % →  45.2 %  ~138 m
     LEFT    El Naby Danial (going south)   45.2 % →  81.1 %  ~613 m
     BOTTOM  El Horeya (going east)         81.1 % → 100.0 %  ~323 m

   Artistic rationale per section:
     Zones  1– 6  (0–9.3 %):   Track 1 — first 25% of Safeya Zaghloul. Music opens quickly.
     Zones  7–10  (9.3–14.4 %): Transition — next portion of Safeya Zaghloul.
     Zones 11–25  (14.4–37.2 %): Track 2 — upper Safeya Zaghloul. Ends at seafront.
     Zones 26–27  (37.2–40.0 %): Transition — top-left corner + start of El Naby.
     Zones 28–31  (40.0–57.1 %): Track 3 — top ~43% of El Naby Danial.
     Zones 32–35  (57.1–100 %): Track 4 — remaining El Naby Danial + all El Horeya.
   ───────────────────────────────────────────────────────────────────────── */
const ZONE_BREAKPOINTS = [
    // ── Track 1: zones 1–6 (0%→9.3%) — first 25% of Safeya Zaghloul ────────
    0.0155, 0.0310, 0.0465, 0.0620, 0.0775, 0.0930,

    // ── Transition: zones 7–10 (9.3%→14.4%) — next portion of Safeya Zaghloul ──
    0.1058, 0.1185, 0.1313, 0.1440,

    // ── Track 2: zones 11–25 (14.4%→37.2%) — upper Safeya Zaghloul ──────────
    0.1592, 0.1744, 0.1896, 0.2048, 0.2200,
    0.2352, 0.2504, 0.2656, 0.2808, 0.2960,
    0.3112, 0.3264, 0.3416, 0.3568, 0.3720,

    // ── Transition: zones 26–27 (37.2%→40.0%) — top-left corner + start of El Naby ──
    0.3860, 0.4000,

    // ── Track 3: zones 28–31 (40.0%→57.1%) — top ~43% of El Naby Danial ─────
    0.4428, 0.4855, 0.5283, 0.5710,

    // ── Track 4: zones 32–35 (57.1%→100%) — rest of El Naby + El Horeya ────
    0.6782, 0.7855, 0.8927, 1.0000
];

/* ─────────────────────────────────────────────────────────────────────────
   ZONE → FAMILY (matches Pd's alexandria_family_progress_morph.pd)
   Index 0 is unused (zones are 1-based).
   Family boundaries trigger morph holds in the Pd patch.
   ───────────────────────────────────────────────────────────────────────── */
const ZONE_FAMILIES = [
    0,                   // [0] unused placeholder
    0, 0, 0, 0, 0,       // zones  1– 5 → family 0 (Track 1)
    1, 1, 1, 1, 1,       // zones  6–10 → family 1 (Transition + opening of T2)
    2, 2, 2, 2,          // zones 11–14 → family 2 (Track 2 build)
    3, 3, 3, 3, 3,       // zones 15–19 → family 3 (Track 2 mid)
    4, 4, 4, 4, 4,       // zones 20–24 → family 4 (Track 2 peak & fade)
    5, 5, 5,             // zones 25–27 → family 5 (Track 2 fade + corner)
    6, 6, 6, 6,          // zones 28–31 → family 6 (Track 3 seafront)
    7, 7, 7, 7           // zones 32–35 → family 7 (Track 4 finale)
];

/** Human-readable name for each family/track section. */
const FAMILY_LABELS = [
    'Track 1',      // family 0
    'Transition',   // family 1
    'Track 2',      // family 2
    'Track 2',      // family 3
    'Track 2',      // family 4
    'Transition',   // family 5
    'Track 3',      // family 6
    'Track 4'       // family 7
];

/* ─────────────────────────────────────────────────────────────────────────
   CORE FUNCTIONS
   ───────────────────────────────────────────────────────────────────────── */

/**
 * Return the shortest metric distance (metres) from [lon, lat] to the
 * nearest point on the route polyline.  Uses the equirectangular
 * approximation — accurate to <1 % over distances < 10 km.
 * @param {number} lon
 * @param {number} lat
 * @param {Array<[number,number]>} line
 * @returns {number} distance in metres
 */
function distanceToRoute(lon, lat, line) {
    const toRad = d => d * Math.PI / 180;
    const cosLat = Math.cos(toRad((lat + line[0][1]) / 2));
    const mPerDegLat = 111319;
    const mPerDegLon = 111319 * cosLat;
    let minDist = Infinity;
    for (let i = 0; i < line.length - 1; i++) {
        const ax = line[i][0],   ay = line[i][1];
        const bx = line[i + 1][0], by = line[i + 1][1];
        const dx = bx - ax, dy = by - ay;
        const lsq = dx * dx + dy * dy;
        const t = lsq > 0
            ? Math.max(0, Math.min(1, ((lon - ax) * dx + (lat - ay) * dy) / lsq))
            : 0;
        const px = ax + t * dx, py = ay + t * dy;
        const dlonM = (lon - px) * mPerDegLon;
        const dlatM = (lat - py) * mPerDegLat;
        const d = Math.sqrt(dlonM * dlonM + dlatM * dlatM);
        if (d < minDist) minDist = d;
    }
    return minDist;
}

/**
 * Return true if the walker is within thresholdM metres of the route line.
 * This is the recommended way to detect whether the walker is on the route.
 * The problem statement specifies a ~45 m detection radius.
 * @param {number} lon
 * @param {number} lat
 * @param {number} [thresholdM=45]
 * @returns {boolean}
 */
function nearRoute(lon, lat, thresholdM = 45) {
    return distanceToRoute(lon, lat, ROUTE_LINE) <= thresholdM;
}

/**
 * Ray-casting point-in-polygon test (kept for general use).
 * NOTE: do NOT use this with ZONE_POLYGON for route detection —
 * use nearRoute() instead.
 * @param {number} lon - Longitude
 * @param {number} lat - Latitude
 * @param {Array<[number,number]>} poly - Array of [lon, lat] pairs
 * @returns {boolean}
 */
function pointInPolygon(lon, lat, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const xi = poly[i][0], yi = poly[i][1];
        const xj = poly[j][0], yj = poly[j][1];
        if (((yi > lat) !== (yj > lat)) &&
            (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi))
            inside = !inside;
    }
    return inside;
}

/**
 * Project a [lon, lat] point onto the polyline and return 0→1 progress.
 * Uses squared-distance in geographic coordinates (suitable for ~1km scale).
 * @param {number} lon
 * @param {number} lat
 * @param {Array<[number,number]>} line
 * @returns {number} 0.0 → 1.0
 */
function projectOntoPolyline(lon, lat, line) {
    // Pre-compute segment lengths
    const segs = [];
    let total = 0;
    for (let i = 0; i < line.length - 1; i++) {
        const dx = line[i + 1][0] - line[i][0];
        const dy = line[i + 1][1] - line[i][1];
        const len = Math.sqrt(dx * dx + dy * dy);
        segs.push(len);
        total += len;
    }

    let best = Infinity, bestAccum = 0, accum = 0;
    for (let i = 0; i < line.length - 1; i++) {
        const ax = line[i][0],   ay = line[i][1];
        const bx = line[i + 1][0], by = line[i + 1][1];
        const dx = bx - ax, dy = by - ay;
        const lsq = dx * dx + dy * dy;
        const t = lsq > 0
            ? Math.max(0, Math.min(1, ((lon - ax) * dx + (lat - ay) * dy) / lsq))
            : 0;
        const px = ax + t * dx, py = ay + t * dy;
        const d = (lon - px) * (lon - px) + (lat - py) * (lat - py);
        if (d < best) {
            best = d;
            bestAccum = accum + t * segs[i];
        }
        accum += segs[i];
    }
    return total > 0 ? bestAccum / total : 0;
}

/**
 * Map 0→1 route progress to a zone number 1–35 using the weighted breakpoints.
 * Uses binary search over ZONE_BREAKPOINTS for O(log n) lookup.
 * @param {number} p - Progress 0.0 → 1.0
 * @returns {number} Integer zone 1–35
 */
function progressToZone(p) {
    // Clamp input
    if (p <= 0) return 1;
    if (p >= 1) return 35;

    // Binary search: find first breakpoint ≥ p
    let lo = 0, hi = ZONE_BREAKPOINTS.length - 1;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (ZONE_BREAKPOINTS[mid] < p) lo = mid + 1;
        else hi = mid;
    }
    // lo is the 0-based index in ZONE_BREAKPOINTS, zone number is lo+1
    return lo + 1;
}

/**
 * Return the track/section label for a given zone number (1–35).
 * @param {number} zone - Integer 1–35
 * @returns {string} e.g. "Track 1", "Track 2", "Transition", "Track 3", "Track 4"
 */
function zoneToTrackLabel(zone) {
    if (zone < 1 || zone > 35) return '';
    const family = ZONE_FAMILIES[zone];
    return FAMILY_LABELS[family] || '';
}

/**
 * Return the family number (0–7) for a given zone (1–35).
 * @param {number} zone
 * @returns {number}
 */
function zoneToFamily(zone) {
    if (zone < 1 || zone > 35) return -1;
    return ZONE_FAMILIES[zone];
}

/* ─────────────────────────────────────────────────────────────────────────
   EXPORT — works as a browser global OR as a CommonJS/ESM module for testing
   ───────────────────────────────────────────────────────────────────────── */
const GeoLogic = {
    ROUTE_LINE,
    OUTER_BORDER,
    ZONE_POLYGON,
    ZONE_BREAKPOINTS,
    ZONE_FAMILIES,
    FAMILY_LABELS,
    distanceToRoute,
    nearRoute,
    pointInPolygon,
    projectOntoPolyline,
    progressToZone,
    zoneToTrackLabel,
    zoneToFamily
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = GeoLogic;
} else if (typeof window !== 'undefined') {
    window.GeoLogic = GeoLogic;
}
