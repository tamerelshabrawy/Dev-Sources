/**
 * gps_zone_bridge.js — Alexandria Pedestrian Soundwalk
 * GPS → pd4web zone bridge.
 *
 * Continuously tracks the device GPS position, maps it to a zone ID (1–35)
 * using the GeoLogic route-projection library (geolocation.js), and sends
 * the zone into the running Pd patch via pd4web's sendFloat API.
 *
 * Dependencies:
 *   geolocation.js  — must be loaded first; exposes window.GeoLogic
 *
 * pd4web API detection (tries in order):
 *   1. window.Pd4WebInstance.sendFloat("zone", id)  — set by index.html boot
 *   2. window.Pd4Web.sendFloat("zone", id)          — embind-exposed class
 *   3. window.Module.sendFloat("zone", id)           — raw Emscripten module
 *
 * Public API (window.GpsZoneBridge):
 *   startTracking()   — request GPS permission and begin watching
 *   stopTracking()    — cancel the GPS watch
 *   simulateZone(id)  — manually fire a zone for desktop testing (bypasses GPS)
 *   getCurrentZone()  — returns the last committed zone ID (0 = outside route)
 *   onZoneChange(fn)  — register a callback fn(zoneId) on each zone change
 *   onStatus(fn)      — register a status callback fn(message, type)
 *                        type ∈ 'info' | 'warn' | 'error' | 'zone' | 'outside'
 *
 * Geolocation settings:
 *   enableHighAccuracy: true  — request the best available fix
 *   maximumAge: 2000 ms       — accept cached fixes up to 2 s old
 *   timeout: 15000 ms         — give up after 15 s with no fix
 *   ACCURACY_THRESHOLD: 50 m  — ignore fixes worse than this
 *
 * Deduplication:
 *   A zone change is only forwarded to Pd after the same zone has been
 *   detected for HYSTERESIS_MS (default 3 000 ms) without interruption.
 *   This prevents GPS noise from flooding the patch with spurious messages.
 *
 * Zone data:
 *   Zone boundaries are derived from the walking-route polyline embedded
 *   in geolocation.js. No separate zone-map file is required.
 *   The 35 zones are arranged in four track sections:
 *     Zones  1– 6  Track 1     start of Safeya Zaghloul going north
 *     Zones  7–10  Transition  continuing north up Safeya Zaghloul
 *     Zones 11–25  Track 2     upper Safeya Zaghloul + seafront
 *     Zones 26–27  Transition  top-left corner + upper El Naby
 *     Zones 28–31  Track 3     El Naby Danial going south
 *     Zones 32–35  Track 4     lower El Naby Danial + El Horeya
 */

'use strict';

(function (root) {

    /* ─────────────────────────────────────────────────────────────────────
       CONFIGURATION — edit here to tune behaviour
       ───────────────────────────────────────────────────────────────────── */
    var GPS_OPTIONS = {
        enableHighAccuracy: true,
        maximumAge:         2000,   // ms — accept cached positions up to 2 s old
        timeout:            15000   // ms — give up waiting for a fix after 15 s
    };
    var ACCURACY_THRESHOLD = 50;    // metres — discard fixes worse than this
    var HYSTERESIS_MS      = 3000;  // ms — zone must be stable before committing
    var ROUTE_THRESHOLD_M  = 45;    // metres — distance to route for "on route"

    /* ─────────────────────────────────────────────────────────────────────
       PLACEHOLDER ZONE WAYPOINTS
       These centre-point + radius entries provide an optional nearest-circle
       fallback when the walker is beyond ROUTE_THRESHOLD_M from the polyline.
       Populate with real Alexandria survey coordinates when available.
       Format: { id, lat, lng, radius }  (radius in metres)
       ───────────────────────────────────────────────────────────────────── */
    var ZONE_WAYPOINTS = [
        // ── Track 1: Safeya Zaghloul Street lower section (going north) ──
        { id:  1, lat: 31.1972, lng: 29.9043, radius: 50 },
        { id:  2, lat: 31.1977, lng: 29.9038, radius: 50 },
        { id:  3, lat: 31.1982, lng: 29.9032, radius: 50 },
        { id:  4, lat: 31.1987, lng: 29.9027, radius: 50 },
        { id:  5, lat: 31.1992, lng: 29.9022, radius: 50 },
        { id:  6, lat: 31.1997, lng: 29.9016, radius: 50 },
        // ── Transition: Safeya Zaghloul upper section ─────────────────────
        { id:  7, lat: 31.2001, lng: 29.9011, radius: 50 },
        { id:  8, lat: 31.2004, lng: 29.9009, radius: 50 },
        { id:  9, lat: 31.2007, lng: 29.9006, radius: 50 },
        { id: 10, lat: 31.2010, lng: 29.9003, radius: 50 },
        // ── Track 2: upper Safeya Zaghloul + seafront/Corniche ────────────
        { id: 11, lat: 31.2011, lng: 29.8996, radius: 50 },
        { id: 12, lat: 31.2014, lng: 29.8996, radius: 50 },
        { id: 13, lat: 31.2013, lng: 29.8993, radius: 50 },
        { id: 14, lat: 31.2011, lng: 29.8988, radius: 50 },
        { id: 15, lat: 31.2010, lng: 29.8986, radius: 50 },
        { id: 16, lat: 31.2010, lng: 29.8985, radius: 50 },
        { id: 17, lat: 31.2009, lng: 29.8985, radius: 50 },
        { id: 18, lat: 31.2008, lng: 29.8986, radius: 50 },
        { id: 19, lat: 31.2007, lng: 29.8987, radius: 50 },
        { id: 20, lat: 31.2006, lng: 29.8988, radius: 50 },
        { id: 21, lat: 31.2005, lng: 29.8989, radius: 50 },
        { id: 22, lat: 31.2004, lng: 29.8990, radius: 50 },
        { id: 23, lat: 31.2003, lng: 29.8991, radius: 50 },
        { id: 24, lat: 31.2002, lng: 29.8992, radius: 50 },
        { id: 25, lat: 31.2001, lng: 29.8993, radius: 50 },
        // ── Transition: top-left corner + start of El Naby Danial ─────────
        { id: 26, lat: 31.2000, lng: 29.8993, radius: 50 },
        { id: 27, lat: 31.1999, lng: 29.8991, radius: 50 },
        // ── Track 3: El Naby Danial Street (going south) ──────────────────
        { id: 28, lat: 31.1997, lng: 29.8993, radius: 50 },
        { id: 29, lat: 31.1990, lng: 29.8997, radius: 50 },
        { id: 30, lat: 31.1983, lng: 29.9001, radius: 50 },
        { id: 31, lat: 31.1976, lng: 29.9004, radius: 50 },
        // ── Track 4: lower El Naby Danial + El Horeya Road (going east) ───
        { id: 32, lat: 31.1970, lng: 29.9007, radius: 50 },
        { id: 33, lat: 31.1964, lng: 29.9010, radius: 50 },
        { id: 34, lat: 31.1963, lng: 29.9020, radius: 50 },
        { id: 35, lat: 31.1965, lng: 29.9035, radius: 50 }
    ];

    /* ─────────────────────────────────────────────────────────────────────
       INTERNAL STATE
       ───────────────────────────────────────────────────────────────────── */
    var _watchId         = null;
    var _currentZone     = 0;
    var _candidateZone   = 0;
    var _candidateSince  = 0;
    var _zoneCallbacks   = [];
    var _statusCallbacks = [];

    /* ─────────────────────────────────────────────────────────────────────
       HELPERS
       ───────────────────────────────────────────────────────────────────── */

    /** Broadcast a status message to all registered status callbacks. */
    function _status(msg, type) {
        _statusCallbacks.forEach(function (fn) {
            try { fn(msg, type || 'info'); } catch (_) {}
        });
        console.log('[GpsZoneBridge] ' + msg);
    }

    /**
     * Return the nearest-circle zone ID for a given {lat, lng} position.
     * Used as a fallback when the walker is beyond ROUTE_THRESHOLD_M from
     * the route polyline. Returns 0 if no zone is within its declared radius.
     * @param {number} lat
     * @param {number} lng
     * @returns {number} zone ID 1–35, or 0 if outside all radii
     */
    function getNearestZone(lat, lng) {
        var best = 0, bestDist = Infinity;
        for (var i = 0; i < ZONE_WAYPOINTS.length; i++) {
            var z = ZONE_WAYPOINTS[i];
            var d = haversineM(lat, lng, z.lat, z.lng);
            if (d < bestDist) {
                bestDist = d;
                best = z.id;
            }
        }
        // Only return a valid zone if within the zone's radius
        if (best > 0) {
            var meta = ZONE_WAYPOINTS[best - 1];
            if (bestDist > (meta ? meta.radius : 50)) best = 0;
        }
        return best;
    }

    /** Haversine distance in metres between two lat/lng points. */
    function haversineM(lat1, lng1, lat2, lng2) {
        var R  = 6371000;
        var p1 = lat1 * Math.PI / 180;
        var p2 = lat2 * Math.PI / 180;
        var dp = (lat2 - lat1) * Math.PI / 180;
        var dl = (lng2 - lng1) * Math.PI / 180;
        var a  = Math.sin(dp / 2) * Math.sin(dp / 2) +
                 Math.cos(p1) * Math.cos(p2) *
                 Math.sin(dl / 2) * Math.sin(dl / 2);
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    /**
     * Locate the pd4web sendFloat function.
     * Tries window.Pd4WebInstance, window.Pd4Web, window.Module in order.
     * Returns a function (receiver, value) => void, or null if unavailable.
     */
    function _getSendFloat() {
        var candidates = [
            root.Pd4WebInstance,
            root.Pd4Web,
            root.Module
        ];
        for (var i = 0; i < candidates.length; i++) {
            var obj = candidates[i];
            if (obj && typeof obj.sendFloat === 'function') {
                return obj.sendFloat.bind(obj);
            }
        }
        return null;
    }

    /* ─────────────────────────────────────────────────────────────────────
       CORE LOGIC
       ───────────────────────────────────────────────────────────────────── */

    /**
     * Commit a zone change: send to Pd and fire callbacks.
     * @param {number} zone — 1–35
     */
    function _commitZone(zone) {
        _currentZone = zone;

        // Send to the running Pd patch
        var sendFloat = _getSendFloat();
        if (sendFloat) {
            sendFloat('zone', zone);
        } else {
            _status('pd4web sendFloat not yet available — zone ' + zone + ' queued', 'warn');
        }

        _zoneCallbacks.forEach(function (fn) {
            try { fn(zone); } catch (_) {}
        });

        _status('Zone ' + zone, 'zone');
    }

    /**
     * Process a raw GPS position reading.
     * Uses GeoLogic.nearRoute + GeoLogic.projectOntoPolyline as primary method;
     * falls back to nearest-circle lookup for positions slightly off-route.
     * @param {number} lon
     * @param {number} lat
     */
    function _processPosition(lon, lat) {
        var gl = root.GeoLogic;
        var zone = 0;

        if (gl) {
            // Primary: route-projection (most accurate)
            if (gl.nearRoute(lon, lat, ROUTE_THRESHOLD_M)) {
                var arc = gl.projectOntoPolyline(lon, lat, gl.ROUTE_LINE);
                zone = gl.progressToZone(arc);
            }
        }

        // Fallback: nearest waypoint circle
        if (zone === 0) {
            zone = getNearestZone(lat, lon);
        }

        if (zone === 0) {
            // Outside route — reset candidate and notify if status changed
            _candidateZone  = 0;
            _candidateSince = 0;
            if (_currentZone !== 0) {
                _currentZone = 0;
                var sendFloat = _getSendFloat();
                if (sendFloat) sendFloat('zone', 0);
                _status('Outside route', 'outside');
            }
            return;
        }

        // Hysteresis: only commit after the zone is stable for HYSTERESIS_MS
        var now = Date.now();
        if (zone !== _candidateZone) {
            _candidateZone  = zone;
            _candidateSince = now;
        }
        if (zone !== _currentZone &&
                (now - _candidateSince >= HYSTERESIS_MS)) {
            _commitZone(zone);
        }
    }

    /* ─────────────────────────────────────────────────────────────────────
       PUBLIC API
       ───────────────────────────────────────────────────────────────────── */

    /**
     * Begin GPS tracking.
     * Calls navigator.geolocation.watchPosition — triggers the browser
     * permission prompt on first call.  Safe to call multiple times.
     */
    function startTracking() {
        if (!('geolocation' in navigator)) {
            _status('Geolocation API not available in this browser', 'error');
            return;
        }
        if (_watchId !== null) {
            navigator.geolocation.clearWatch(_watchId);
        }
        _candidateZone  = 0;
        _candidateSince = 0;
        _status('Acquiring GPS…', 'info');

        _watchId = navigator.geolocation.watchPosition(
            function (pos) {
                var acc = pos.coords.accuracy;
                if (acc > ACCURACY_THRESHOLD) {
                    _status('Weak GPS fix ±' + Math.round(acc) + ' m (need ≤' + ACCURACY_THRESHOLD + ' m)', 'warn');
                    return;
                }
                _processPosition(pos.coords.longitude, pos.coords.latitude);
            },
            function (err) {
                // Errors are logged but do NOT crash the audio engine
                _status('GPS error (' + err.code + '): ' + err.message, 'error');
            },
            GPS_OPTIONS
        );
    }

    /** Cancel GPS watching. Does nothing if tracking is not active. */
    function stopTracking() {
        if (_watchId !== null) {
            navigator.geolocation.clearWatch(_watchId);
            _watchId = null;
        }
        _status('GPS tracking stopped', 'info');
    }

    /**
     * Manually fire a zone — useful for desktop/emulator testing.
     * Bypasses GPS and hysteresis entirely.
     * @param {number} id — zone 1–35
     */
    function simulateZone(id) {
        var zone = Math.min(35, Math.max(1, Math.round(id)));
        _commitZone(zone);
    }

    /** Return the last committed zone ID (0 = outside route). */
    function getCurrentZone() {
        return _currentZone;
    }

    /**
     * Register a zone-change callback.
     * @param {function(number)} fn — called with the new zone ID (1–35)
     */
    function onZoneChange(fn) {
        _zoneCallbacks.push(fn);
    }

    /**
     * Register a status callback.
     * @param {function(string, string)} fn — called with (message, type)
     *   type ∈ 'info' | 'warn' | 'error' | 'zone' | 'outside'
     */
    function onStatus(fn) {
        _statusCallbacks.push(fn);
    }

    /* ─────────────────────────────────────────────────────────────────────
       EXPORT
       ───────────────────────────────────────────────────────────────────── */
    root.GpsZoneBridge = {
        startTracking:  startTracking,
        stopTracking:   stopTracking,
        simulateZone:   simulateZone,
        getCurrentZone: getCurrentZone,
        onZoneChange:   onZoneChange,
        onStatus:       onStatus,
        // Exposed for external access / testing
        ZONE_WAYPOINTS:  ZONE_WAYPOINTS,
        _getNearestZone: getNearestZone
    };

})(typeof window !== 'undefined' ? window : global);
