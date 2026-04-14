/**
 * gps-zone-driver.js — Alexandria Pedestrian Soundwalk
 * GPS → pd4web zone bridge.
 *
 * Loads zone-map.json, watches the device's Geolocation API and maps the
 * walker's position onto zones 1–35 using two complementary methods:
 *
 *   1. Route-projection  (primary, accurate):
 *      Projects the GPS fix onto the route polyline, computes 0→1 arc
 *      progress and maps that to a zone via the weighted ZONE_BREAKPOINTS
 *      table.  Only fires when the walker is ≤45 m from the route line.
 *
 *   2. Nearest-circle  (fallback for zone-map.json users):
 *      Finds the zone whose center is closest by haversine distance and
 *      is within that zone's declared radius.
 *
 * Hysteresis: a zone change is only accepted after the new zone has been
 * continuously detected for HYSTERESIS_MS (default 3 000 ms), preventing
 * noise-induced flicker.
 *
 * Once a zone change is committed the module calls:
 *   Pd4Web.sendFloat("zone",     zoneId)       — integer 1–35
 *   Pd4Web.sendFloat("progress", progressValue) — 0.0 – 1.0
 *
 * Public API (window.GpsZoneDriver):
 *   startTracking()          — request GPS permission & begin watching
 *   stopTracking()           — cancel GPS watch
 *   simulateZone(id, prog?)  — manually fire a zone (desktop testing)
 *   getCurrentZone()         — returns { zone, progress, name, track }
 *   onZoneChange(fn)         — register a callback (zone, progress, name)
 *   onStatus(fn)             — register a status/error callback (message, type)
 *
 * Dependencies:  none (all route data embedded below).
 * Browser reqs:  Geolocation API, Fetch API (for zone-map.json), ES6.
 */

'use strict';

/* ─────────────────────────────────────────────────────────────────────────
   EMBEDDED ROUTE DATA  (mirrors custom-js/geolocation.js)
   right_side inner route, [longitude, latitude], clockwise walk order.
   ───────────────────────────────────────────────────────────────────────── */
const ROUTE_LINE = [
    [29.9042702, 31.1971939],[29.9042697, 31.1971939],[29.9041345, 31.1974428],
    [29.9039240, 31.1976572],[29.9037191, 31.1978710],[29.9035805, 31.1980146],
    [29.9034668, 31.1981114],[29.9032732, 31.1982327],[29.9030305, 31.1984446],
    [29.9029072, 31.1985722],[29.9027810, 31.1987394],[29.9026791, 31.1988579],
    [29.9025586, 31.1989869],[29.9022687, 31.1992511],[29.9019591, 31.1995458],
    [29.9019591, 31.1995458],[29.9015999, 31.1998636],[29.9013854, 31.2000587],
    [29.9011287, 31.2002840],[29.9008607, 31.2005171],[29.9005950, 31.2007425],
    [29.9003518, 31.2009563],[29.8996133, 31.2010997],
    [29.8995806, 31.2014050],[29.8992918, 31.2012976],
    [29.8988268, 31.2011214],[29.8985785, 31.2010352],
    [29.8988634, 31.2004477],[29.8990220, 31.2001435],[29.8991065, 31.1999369],
    [29.8993131, 31.1997794],[29.8995214, 31.1996210],[29.9000878, 31.1984075],
    [29.9002448, 31.1980737],[29.9003473, 31.1978637],[29.9004363, 31.1976696],
    [29.9005354, 31.1974520],[29.9007290, 31.1970330],[29.9008214, 31.1968278],
    [29.9009196, 31.1966127],[29.9009838, 31.1964567],[29.9010204, 31.1963777],
    [29.9010739, 31.1962588],[29.9011093, 31.1961634],[29.9011600, 31.1960329],
    [29.9026919, 31.1965935],[29.9030252, 31.1967192],[29.9032994, 31.1968217],
    [29.9035612, 31.1969195],[29.9038177, 31.1970196],[29.9040266, 31.1970967],
    [29.9042715, 31.1971886]
];

/* Weighted arc breakpoints — ZONE_BREAKPOINTS[i] is the upper bound of zone i+1 */
const ZONE_BREAKPOINTS = [
    0.0155, 0.0310, 0.0465, 0.0620, 0.0775, 0.0930,
    0.1058, 0.1185, 0.1313, 0.1440,
    0.1592, 0.1744, 0.1896, 0.2048, 0.2200,
    0.2352, 0.2504, 0.2656, 0.2808, 0.2960,
    0.3112, 0.3264, 0.3416, 0.3568, 0.3720,
    0.3860, 0.4000,
    0.4428, 0.4855, 0.5283, 0.5710,
    0.6782, 0.7855, 0.8927, 1.0000
];

/* ─────────────────────────────────────────────────────────────────────────
   CONFIGURATION
   ───────────────────────────────────────────────────────────────────────── */
const GPS_OPTIONS = { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 };
const ROUTE_THRESHOLD_M  = 45;    // metres — distance to route for "on route"
const HYSTERESIS_MS      = 3000;  // ms — zone must be stable before committing
const ACCURACY_THRESHOLD = 50;    // metres — ignore GPS fixes worse than this

/* ─────────────────────────────────────────────────────────────────────────
   PURE GEOMETRY HELPERS
   ───────────────────────────────────────────────────────────────────────── */

/** Haversine distance in metres between two {lat,lng} points. */
function haversineM(a, b) {
    const R = 6371000;
    const φ1 = a.lat * Math.PI / 180, φ2 = b.lat * Math.PI / 180;
    const Δφ = (b.lat - a.lat) * Math.PI / 180;
    const Δλ = (b.lng - a.lng) * Math.PI / 180;
    const s  = Math.sin(Δφ/2)**2 + Math.cos(φ1)*Math.cos(φ2)*Math.sin(Δλ/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1-s));
}

/**
 * Shortest distance in metres from [lon, lat] to the nearest point
 * on the route polyline.  Uses equirectangular approximation.
 */
function distanceToRouteM(lon, lat) {
    const toRad    = d => d * Math.PI / 180;
    const cosLat   = Math.cos(toRad((lat + ROUTE_LINE[0][1]) / 2));
    const mPerLat  = 111319;
    const mPerLon  = 111319 * cosLat;
    let minDist    = Infinity;
    for (let i = 0; i < ROUTE_LINE.length - 1; i++) {
        const ax = ROUTE_LINE[i][0],     ay = ROUTE_LINE[i][1];
        const bx = ROUTE_LINE[i+1][0],   by = ROUTE_LINE[i+1][1];
        const dx = bx - ax, dy = by - ay;
        const lsq = dx*dx + dy*dy;
        const t   = lsq > 0
            ? Math.max(0, Math.min(1, ((lon-ax)*dx + (lat-ay)*dy) / lsq))
            : 0;
        const px  = ax + t*dx, py = ay + t*dy;
        const d   = Math.sqrt(((lon-px)*mPerLon)**2 + ((lat-py)*mPerLat)**2);
        if (d < minDist) minDist = d;
    }
    return minDist;
}

/**
 * Project [lon, lat] onto the route polyline and return 0→1 arc progress.
 */
function projectOntoRoute(lon, lat) {
    const segs = []; let total = 0;
    for (let i = 0; i < ROUTE_LINE.length - 1; i++) {
        const dx = ROUTE_LINE[i+1][0] - ROUTE_LINE[i][0];
        const dy = ROUTE_LINE[i+1][1] - ROUTE_LINE[i][1];
        const len = Math.sqrt(dx*dx + dy*dy);
        segs.push(len);
        total += len;
    }
    let best = Infinity, bestAccum = 0, accum = 0;
    for (let i = 0; i < ROUTE_LINE.length - 1; i++) {
        const ax = ROUTE_LINE[i][0],   ay = ROUTE_LINE[i][1];
        const bx = ROUTE_LINE[i+1][0], by = ROUTE_LINE[i+1][1];
        const dx = bx-ax, dy = by-ay;
        const lsq = dx*dx + dy*dy;
        const t   = lsq > 0
            ? Math.max(0, Math.min(1, ((lon-ax)*dx + (lat-ay)*dy) / lsq))
            : 0;
        const px = ax+t*dx, py = ay+t*dy;
        const d  = (lon-px)**2 + (lat-py)**2;
        if (d < best) { best = d; bestAccum = accum + t*segs[i]; }
        accum += segs[i];
    }
    return total > 0 ? bestAccum / total : 0;
}

/** Map 0→1 route progress to a zone 1–35 using binary search. */
function progressToZone(p) {
    if (p <= 0) return 1;
    if (p >= 1) return 35;
    let lo = 0, hi = ZONE_BREAKPOINTS.length - 1;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (ZONE_BREAKPOINTS[mid] < p) lo = mid + 1;
        else hi = mid;
    }
    return lo + 1;
}

/** 0→1 progress within zone zoneId for a given route arc progress p. */
function intraZoneProgress(p, zoneId) {
    const lo = zoneId === 1 ? 0 : ZONE_BREAKPOINTS[zoneId - 2];
    const hi = ZONE_BREAKPOINTS[zoneId - 1];
    if (hi <= lo) return 0;
    return Math.max(0, Math.min(1, (p - lo) / (hi - lo)));
}

/* ─────────────────────────────────────────────────────────────────────────
   MAIN MODULE
   ───────────────────────────────────────────────────────────────────────── */
(function (root) {

    let _zones           = [];          // populated from zone-map.json
    let _watchId         = null;
    let _currentZone     = 0;
    let _currentProgress = 0;
    let _candidateZone   = 0;
    let _candidateSince  = 0;          // timestamp when candidate zone first seen
    let _zoneCallbacks   = [];
    let _statusCallbacks = [];
    let _Pd4Web          = null;       // set by setPd4Web() or auto-detected

    /* ── Internal helpers ─────────────────────────────────────────────── */

    function _status(msg, type) {
        _statusCallbacks.forEach(fn => { try { fn(msg, type || 'info'); } catch (_) {} });
    }

    function _commitZone(zone, progress) {
        _currentZone     = zone;
        _currentProgress = progress;
        const meta = _zones[zone - 1] || {};
        const name = meta.name  || `Zone ${zone}`;
        const track = meta.track || '';

        // Send to pd4web
        const pd = _Pd4Web || (root.Pd4Web) || (root.Pd4WebInstance);
        if (pd && typeof pd.sendFloat === 'function') {
            pd.sendFloat('zone',     zone);
            pd.sendFloat('progress', progress);
        }

        _zoneCallbacks.forEach(fn => {
            try { fn(zone, progress, name, track); } catch (_) {}
        });
        _status(`Zone ${zone} · ${name} · progress ${progress.toFixed(2)}`, 'zone');
    }

    function _processPosition(lon, lat) {
        let zone = 0, progress = 0;

        // Primary: route-projection
        const distM = distanceToRouteM(lon, lat);
        if (distM <= ROUTE_THRESHOLD_M) {
            const arc  = projectOntoRoute(lon, lat);
            zone       = progressToZone(arc);
            progress   = intraZoneProgress(arc, zone);
        } else if (_zones.length > 0) {
            // Fallback: nearest zone circle (haversine)
            let minDist = Infinity;
            for (const z of _zones) {
                const d = haversineM({ lat, lng: lon }, z.center);
                if (d < minDist) { minDist = d; zone = z.id; }
            }
            const meta = _zones[zone - 1] || {};
            if (minDist > (meta.radius || 45) * 2) zone = 0; // too far away
            progress = 0;
        }

        if (zone === 0) {
            _candidateZone  = 0;
            _candidateSince = 0;
            if (_currentZone !== 0) {
                _currentZone     = 0;
                _currentProgress = 0;
                _status('Outside route', 'outside');
                const pd = _Pd4Web || root.Pd4Web || root.Pd4WebInstance;
                if (pd && typeof pd.sendFloat === 'function') pd.sendFloat('zone', 0);
            }
            return;
        }

        // Hysteresis: only commit after the candidate is stable for HYSTERESIS_MS
        const now = Date.now();
        if (zone !== _candidateZone) {
            _candidateZone  = zone;
            _candidateSince = now;
        }
        if (now - _candidateSince >= HYSTERESIS_MS || zone === _currentZone) {
            if (zone !== _currentZone || Math.abs(progress - _currentProgress) > 0.01) {
                _commitZone(zone, progress);
            }
        }
    }

    /* ── Public API ───────────────────────────────────────────────────── */

    /**
     * Set the pd4web module instance explicitly.
     * If not called, the driver will look for window.Pd4Web / window.Pd4WebInstance.
     */
    function setPd4Web(instance) { _Pd4Web = instance; }

    /**
     * Load zone-map.json (for metadata / fallback circles) and start GPS.
     * Resolves when the GPS watch is registered (not when first fix arrives).
     * @param {string} [zoneMapUrl='./zone-map.json']
     */
    function startTracking(zoneMapUrl) {
        const url = zoneMapUrl || './zone-map.json';
        return fetch(url)
            .then(r => r.json())
            .then(data => {
                _zones = data.zones || [];
                _status(`Loaded ${_zones.length} zones from ${url}`, 'info');
            })
            .catch(err => {
                _status(`zone-map.json not loaded (${err.message}) — using route-projection only`, 'warn');
            })
            .finally(() => _startGPS());
    }

    function _startGPS() {
        if (!('geolocation' in navigator)) {
            _status('Geolocation API not available', 'error');
            return;
        }
        if (_watchId !== null) navigator.geolocation.clearWatch(_watchId);
        _candidateZone  = 0;
        _candidateSince = 0;
        _status('Acquiring GPS…', 'info');
        _watchId = navigator.geolocation.watchPosition(
            pos => {
                const acc = pos.coords.accuracy;
                if (acc > ACCURACY_THRESHOLD) {
                    _status(`Weak GPS signal ±${Math.round(acc)} m (need ≤${ACCURACY_THRESHOLD} m)`, 'warn');
                    return;
                }
                _processPosition(pos.coords.longitude, pos.coords.latitude);
            },
            err => {
                _status(`GPS error (${err.code}): ${err.message}`, 'error');
            },
            GPS_OPTIONS
        );
    }

    /** Cancel GPS watching. */
    function stopTracking() {
        if (_watchId !== null) {
            navigator.geolocation.clearWatch(_watchId);
            _watchId = null;
        }
        _status('GPS tracking stopped', 'info');
    }

    /**
     * Manually fire a zone — for desktop/simulation testing.
     * Bypasses hysteresis and GPS entirely.
     * @param {number} id       Zone 1–35
     * @param {number} [prog=0] Optional intra-zone progress 0.0 – 1.0
     */
    function simulateZone(id, prog) {
        const zone     = Math.min(35, Math.max(1, Math.round(id)));
        const progress = (typeof prog === 'number') ? Math.max(0, Math.min(1, prog)) : 0;
        _candidateZone  = zone;
        _candidateSince = Date.now() - HYSTERESIS_MS; // bypass hold
        _commitZone(zone, progress);
    }

    /** Return current state snapshot. */
    function getCurrentZone() {
        const meta = _zones[_currentZone - 1] || {};
        return {
            zone:     _currentZone,
            progress: _currentProgress,
            name:     meta.name  || (_currentZone ? `Zone ${_currentZone}` : 'Outside route'),
            track:    meta.track || ''
        };
    }

    /**
     * Register a zone-change callback.
     * fn(zoneId, progress, zoneName, track)
     */
    function onZoneChange(fn) { _zoneCallbacks.push(fn); }

    /**
     * Register a status callback.
     * fn(message, type)  where type ∈ 'info' | 'warn' | 'error' | 'zone' | 'outside'
     */
    function onStatus(fn) { _statusCallbacks.push(fn); }

    /* ── Export ───────────────────────────────────────────────────────── */
    root.GpsZoneDriver = {
        startTracking,
        stopTracking,
        simulateZone,
        getCurrentZone,
        onZoneChange,
        onStatus,
        setPd4Web,
        // Exposed for testing / external use
        _haversineM:     haversineM,
        _distToRoute:    distanceToRouteM,
        _projectOnRoute: projectOntoRoute,
        _progressToZone: progressToZone
    };

})(typeof window !== 'undefined' ? window : global);
