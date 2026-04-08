/**
 * simulate.js — Alexandria Soundwalk Walk Simulator
 *
 * Auto-advances through zones 1 → 35 at a configurable pace.
 * Useful for testing the full musical experience without physically walking
 * along the route.
 *
 * Usage — browser (include after gps-zone-driver.js):
 *   WalkSimulator.start({ pace: 20000 });   // fire each zone every 20 s
 *   WalkSimulator.stop();
 *   WalkSimulator.jumpTo(15);              // jump to a specific zone
 *
 * Usage — Node.js (for automated testing):
 *   const sim = require('./simulate');
 *   sim.start({ pace: 200, onZone: (z) => console.log('zone', z) });
 */

'use strict';

(function (root) {

    let _timer      = null;
    let _zone       = 0;
    let _pace       = 20000;    // ms per zone step
    let _progTimer  = null;
    let _progStep   = 0;
    let _options    = {};

    function _emit(zone, progress) {
        const driver = root.GpsZoneDriver;
        if (driver && typeof driver.simulateZone === 'function') {
            driver.simulateZone(zone, progress);
        }
        if (typeof _options.onZone === 'function') {
            _options.onZone(zone, progress);
        }
    }

    function _animateProgress(zone, durationMs) {
        clearInterval(_progTimer);
        const steps    = 20;
        const interval = durationMs / steps;
        let   step     = 0;
        _progTimer = setInterval(function () {
            step++;
            const progress = Math.min(1, step / steps);
            _emit(zone, progress);
            if (step >= steps) clearInterval(_progTimer);
        }, interval);
    }

    function _step() {
        _zone++;
        if (_zone > 35) {
            if (_options.loop) {
                _zone = 1;
            } else {
                stop();
                if (typeof _options.onComplete === 'function') _options.onComplete();
                return;
            }
        }
        _emit(_zone, 0);
        _animateProgress(_zone, _pace * 0.8);
    }

    /**
     * Start the simulation.
     * @param {object} [opts]
     * @param {number}   [opts.pace=20000]    Milliseconds per zone.
     * @param {number}   [opts.startZone=1]   First zone to fire.
     * @param {boolean}  [opts.loop=false]    Restart from zone 1 after zone 35.
     * @param {Function} [opts.onZone]        Called with (zoneId, progress) each step.
     * @param {Function} [opts.onComplete]    Called when simulation finishes (no-loop).
     */
    function start(opts) {
        stop();
        _options = opts || {};
        _pace    = (_options.pace  > 0 ? _options.pace  : 20000);
        _zone    = (_options.startZone > 0 ? _options.startZone - 1 : 0);
        _step();                              // fire first zone immediately
        _timer = setInterval(_step, _pace);
    }

    /** Stop the simulation and clear all timers. */
    function stop() {
        clearInterval(_timer);
        clearInterval(_progTimer);
        _timer = _progTimer = null;
    }

    /**
     * Jump directly to a zone without waiting for the timer.
     * @param {number} zone  Target zone 1–35.
     */
    function jumpTo(zone) {
        _zone = Math.min(35, Math.max(1, Math.round(zone))) - 1;
        _step();
    }

    /** Return the currently simulated zone number (0 = not started). */
    function currentZone() { return _zone; }

    root.WalkSimulator = { start, stop, jumpTo, currentZone };

    // CommonJS export for Node.js testing
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = root.WalkSimulator;
    }

})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : {}));
