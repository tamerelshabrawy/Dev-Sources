#!/usr/bin/env node
/**
 * generate-zones-geojson.js
 * Generates docs/alexandria-soundwalk-zones.geojson from the data in
 * custom-js/geolocation.js — suitable for opening in QGIS, Mapbox,
 * geojson.io, Google Earth, or any GIS tool.
 *
 * Features generated:
 *  - 1 full-route LineString
 *  - 6 track-coloured segment LineStrings
 *  - 35 zone Point features (midpoint of each arc segment)
 */

'use strict';

const path = require('path');
const fs   = require('fs');

const {
    ROUTE_LINE,
    ZONE_BREAKPOINTS,
    ZONE_FAMILIES,
    FAMILY_LABELS
} = require(path.join(__dirname, '..', 'custom-js', 'geolocation.js'));

/* ── Colour map (track section → hex colour) ──────────────────────────── */
const SECTION_COLORS = {
    'Track 1':    '#0e7c7b',
    'Transition': '#f4a261',
    'Track 2':    '#e63946',
    'Track 3':    '#457b9d',
    'Track 4':    '#7b2d8e'
};

/**
 * Colour for a given zone number (1–35).
 * Zones 7–10 and 26–27 are Transition; rest follows track grouping.
 */
function colorForZone(zone) {
    const family = ZONE_FAMILIES[zone];
    const label  = FAMILY_LABELS[family];
    return SECTION_COLORS[label] || '#888888';
}

/* ── Arc-length helpers ────────────────────────────────────────────────── */

/**
 * Euclidean distance between two [lon, lat] points (in degrees — used only
 * for ratio calculations so the unit cancels out).
 */
function segLen(a, b) {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Pre-compute cumulative arc lengths along ROUTE_LINE.
 * Returns { cumLengths: number[], totalLength: number }
 * cumLengths[i] = arc length from vertex 0 to vertex i.
 */
function buildCumLengths(line) {
    const cumLengths = [0];
    for (let i = 1; i < line.length; i++) {
        cumLengths.push(cumLengths[i - 1] + segLen(line[i - 1], line[i]));
    }
    return { cumLengths, totalLength: cumLengths[cumLengths.length - 1] };
}

const { cumLengths, totalLength } = buildCumLengths(ROUTE_LINE);

/**
 * Interpolate [lon, lat] at progress p (0→1) along ROUTE_LINE.
 */
function interpolate(p) {
    if (p <= 0) return ROUTE_LINE[0].slice();
    if (p >= 1) return ROUTE_LINE[ROUTE_LINE.length - 1].slice();

    const target = p * totalLength;
    // Binary search for the segment
    let lo = 0, hi = cumLengths.length - 2;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (cumLengths[mid + 1] < target) lo = mid + 1;
        else hi = mid;
    }
    const segStart = cumLengths[lo];
    const segEnd   = cumLengths[lo + 1];
    const t = segEnd > segStart ? (target - segStart) / (segEnd - segStart) : 0;
    const a = ROUTE_LINE[lo];
    const b = ROUTE_LINE[lo + 1];
    return [
        a[0] + t * (b[0] - a[0]),
        a[1] + t * (b[1] - a[1])
    ];
}

/**
 * Extract a sub-polyline from progress pStart to pEnd (inclusive endpoints
 * interpolated; inner vertices included when they fall within the range).
 */
function sliceRoute(pStart, pEnd) {
    const startLen = pStart * totalLength;
    const endLen   = pEnd   * totalLength;
    const coords   = [interpolate(pStart)];

    for (let i = 1; i < ROUTE_LINE.length - 1; i++) {
        const cl = cumLengths[i];
        if (cl > startLen && cl < endLen) {
            coords.push(ROUTE_LINE[i].slice());
        }
    }
    coords.push(interpolate(pEnd));
    return coords;
}

/* ── Build features ────────────────────────────────────────────────────── */

const features = [];

/* 1. Full route LineString */
features.push({
    type: 'Feature',
    properties: {
        name:              'Alexandria Soundwalk Route',
        total_zones:       35,
        total_tracks:      4,
        approx_distance_m: 1709
    },
    geometry: {
        type:        'LineString',
        coordinates: ROUTE_LINE.map(c => c.slice())
    }
});

/* 2. Track-coloured segment LineStrings */
const TRACK_SECTIONS = [
    { name: 'Track 1',           pStart: 0.000, pEnd: 0.0930, color: '#0e7c7b' },
    { name: 'Transition (7–10)', pStart: 0.0930, pEnd: 0.1440, color: '#f4a261' },
    { name: 'Track 2',           pStart: 0.1440, pEnd: 0.3720, color: '#e63946' },
    { name: 'Transition (26–27)',pStart: 0.3720, pEnd: 0.4000, color: '#f4a261' },
    { name: 'Track 3',           pStart: 0.4000, pEnd: 0.5710, color: '#457b9d' },
    { name: 'Track 4',           pStart: 0.5710, pEnd: 1.000, color: '#7b2d8e' }
];

for (const section of TRACK_SECTIONS) {
    features.push({
        type: 'Feature',
        properties: {
            name:           section.name,
            color:          section.color,
            arc_start_pct:  parseFloat((section.pStart * 100).toFixed(1)),
            arc_end_pct:    parseFloat((section.pEnd   * 100).toFixed(1))
        },
        geometry: {
            type:        'LineString',
            coordinates: sliceRoute(section.pStart, section.pEnd)
        }
    });
}

/* 3. Zone Point features */
for (let zone = 1; zone <= 35; zone++) {
    const arcStart = zone === 1 ? 0 : ZONE_BREAKPOINTS[zone - 2];
    const arcEnd   = ZONE_BREAKPOINTS[zone - 1];
    const arcMid   = (arcStart + arcEnd) / 2;

    const family = ZONE_FAMILIES[zone];
    const track  = FAMILY_LABELS[family];
    const color  = colorForZone(zone);
    const coord  = interpolate(arcMid);

    features.push({
        type: 'Feature',
        properties: {
            zone:          zone,
            track:         track,
            family:        family,
            color:         color,
            arc_start_pct: parseFloat((arcStart * 100).toFixed(3)),
            arc_end_pct:   parseFloat((arcEnd   * 100).toFixed(3)),
            arc_mid_pct:   parseFloat((arcMid   * 100).toFixed(3))
        },
        geometry: {
            type:        'Point',
            coordinates: coord
        }
    });
}

/* ── Write GeoJSON ─────────────────────────────────────────────────────── */

const geojson = {
    type:     'FeatureCollection',
    features: features
};

const outPath = path.join(__dirname, '..', 'docs', 'alexandria-soundwalk-zones.geojson');
fs.writeFileSync(outPath, JSON.stringify(geojson, null, 2) + '\n', 'utf8');
console.log(`Wrote ${features.length} features to ${outPath}`);
