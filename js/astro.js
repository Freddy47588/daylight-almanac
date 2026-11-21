/*
 * astro.js — a small, dependency-free astronomy engine.
 *
 * Sun & moon positions use the low-precision formulas from
 * "Astronomy Answers" (aa.quae.nl), accurate to roughly a minute for
 * rise/set times between latitudes ±70°. Events are found by sampling the
 * altitude curve and interpolating crossings, which keeps polar edge cases
 * (midnight sun, polar night, multiple crossings) honest.
 *
 * Exposed as window.Astro so the site runs straight from file:// too.
 */
(function (global) {
  'use strict';

  const PI = Math.PI;
  const rad = PI / 180;
  const { sin, cos, tan, asin, atan2, acos } = Math;
  const DAY_MS = 86400000;
  const J1970 = 2440588;
  const J2000 = 2451545;
  const OBLIQUITY = rad * 23.4397;
  const SYNODIC_MONTH = 29.530588853;

  /* ---------- core coordinates ---------- */

  const toDays = (ms) => ms / DAY_MS - 0.5 + J1970 - J2000;
  const rightAscension = (l, b) => atan2(sin(l) * cos(OBLIQUITY) - tan(b) * sin(OBLIQUITY), cos(l));
  const declination = (l, b) => asin(sin(b) * cos(OBLIQUITY) + cos(b) * sin(OBLIQUITY) * sin(l));
  const azimuthOf = (H, phi, dec) => atan2(sin(H), cos(H) * sin(phi) - tan(dec) * cos(phi));
  const altitudeOf = (H, phi, dec) => asin(sin(phi) * sin(dec) + cos(phi) * cos(dec) * cos(H));
  const siderealTime = (d, lw) => rad * (280.16 + 360.9856235 * d) - lw;

  function refraction(h) {
    if (h < 0) h = 0;
    return 0.0002967 / tan(h + 0.00312536 / (h + 0.08901179));
  }

  function sunCoords(d) {
    const M = rad * (357.5291 + 0.98560028 * d);
    const C = rad * (1.9148 * sin(M) + 0.02 * sin(2 * M) + 0.0003 * sin(3 * M));
    const L = M + C + rad * 102.9372 + PI;
    return { dec: declination(L, 0), ra: rightAscension(L, 0) };
  }

  function moonCoords(d) {
    const L = rad * (218.316 + 13.176396 * d);
    const M = rad * (134.963 + 13.064993 * d);
    const F = rad * (93.272 + 13.22935 * d);
    const l = L + rad * 6.289 * sin(M);
    const b = rad * 5.128 * sin(F);
    return { ra: rightAscension(l, b), dec: declination(l, b), dist: 385001 - 20905 * cos(M) };
  }

  /** Convert an equatorial position (radians) to local horizon coords (degrees, azimuth from north). */
  function horizon(ms, lat, lng, ra, dec) {
    const d = toDays(ms);
    const H = siderealTime(d, rad * -lng) - ra;
    const phi = rad * lat;
    return {
      altitude: altitudeOf(H, phi, dec) / rad,
      azimuth: ((azimuthOf(H, phi, dec) / rad) + 540) % 360,
    };
  }

  /** Geometric altitude of the sun's centre (no refraction). Fast path for sampling. */
  function sunAltitude(ms, lat, lng) {
    const d = toDays(ms);
    const c = sunCoords(d);
    const H = siderealTime(d, rad * -lng) - c.ra;
    return altitudeOf(H, rad * lat, c.dec) / rad;
  }

  function sunPosition(ms, lat, lng) {
    const c = sunCoords(toDays(ms));
    return horizon(ms, lat, lng, c.ra, c.dec);
  }

  function moonPosition(ms, lat, lng) {
    const c = moonCoords(toDays(ms));
    const p = horizon(ms, lat, lng, c.ra, c.dec);
    const h = p.altitude * rad;
    p.altitude = (h + refraction(h)) / rad;
    p.distance = c.dist;
    return p;
  }

  function moonIllumination(ms) {
    const d = toDays(ms);
    const s = sunCoords(d);
    const m = moonCoords(d);
    const sdist = 149598000;
    const phi = acos(sin(s.dec) * sin(m.dec) + cos(s.dec) * cos(m.dec) * cos(s.ra - m.ra));
    const inc = atan2(sdist * sin(phi), m.dist - sdist * cos(phi));
    const angle = atan2(
      cos(s.dec) * sin(s.ra - m.ra),
      sin(s.dec) * cos(m.dec) - cos(s.dec) * sin(m.dec) * cos(s.ra - m.ra)
    );
    const phase = 0.5 + (0.5 * inc * (angle < 0 ? -1 : 1)) / PI;
    return { fraction: (1 + cos(inc)) / 2, phase, age: phase * SYNODIC_MONTH };
  }

  function phaseName(phase) {
    const names = [
      'New Moon', 'Waxing Crescent', 'First Quarter', 'Waxing Gibbous',
      'Full Moon', 'Waning Gibbous', 'Last Quarter', 'Waning Crescent',
    ];
    return names[Math.floor(((phase * 8) + 0.5) % 8)];
  }

  /* ---------- time zones (via Intl, no tz database needed) ---------- */

  const dtfCache = new Map();
  function partsFormatter(tz) {
    if (!dtfCache.has(tz)) {
      dtfCache.set(tz, new Intl.DateTimeFormat('en-US', {
        timeZone: tz, hourCycle: 'h23',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      }));
    }
    return dtfCache.get(tz);
  }

  function zonedParts(tz, ms) {
    const out = {};
    for (const p of partsFormatter(tz).formatToParts(new Date(ms))) out[p.type] = p.value;
    return {
      y: +out.year, m: +out.month, d: +out.day,
      h: +out.hour % 24, min: +out.minute, s: +out.second,
    };
  }

  function tzOffset(tz, ms) {
    const p = zonedParts(tz, ms);
    const asUTC = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s);
    return asUTC - Math.floor(ms / 1000) * 1000;
  }

  /** UTC epoch ms of local midnight for a calendar date in a zone (DST-safe). */
  function zonedMidnight(y, m, d, tz) {
    const guess = Date.UTC(y, m - 1, d);
    const off = tzOffset(tz, guess);
    let t = guess - off;
    const off2 = tzOffset(tz, t);
    if (off2 !== off) t = guess - off2;
    return t;
  }

  /* ---------- event finding ---------- */

  function sample(fn, start, end, stepMin) {
    const step = stepMin * 60000;
    const out = [];
    for (let t = start; t <= end; t += step) out.push({ t, v: fn(t) });
    return out;
  }

  function crossings(samples, threshold) {
    const res = [];
    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1], b = samples[i];
      const da = a.v - threshold, db = b.v - threshold;
      if ((da < 0 && db >= 0) || (da >= 0 && db < 0)) {
        const f = da / (da - db);
        res.push({ t: a.t + f * (b.t - a.t), rising: db >= 0 });
      }
    }
    return res;
  }

  const firstOf = (list, rising) => {
    const hit = list.find((c) => c.rising === rising);
    return hit ? hit.t : null;
  };

  const THRESHOLDS = {
    horizon: -0.833,
    golden: 6,
    goldenLow: -4,
    civil: -6,
    nautical: -12,
    astronomical: -18,
  };

  /** Everything that happens to the sun between two instants (usually one local day). */
  function sunDay(start, end, lat, lng) {
    const samples = sample((t) => sunAltitude(t, lat, lng), start, end, 1);
    const ev = {};
    const at = (key) => crossings(samples, THRESHOLDS[key]);

    const hz = at('horizon');
    ev.sunrise = firstOf(hz, true);
    ev.sunset = firstOf(hz, false);
    const gold = at('golden');
    ev.goldenMorningEnd = firstOf(gold, true);
    ev.goldenEveningStart = firstOf(gold, false);
    const low = at('goldenLow');
    ev.blueMorningEnd = firstOf(low, true);   // blue hour ends / golden starts
    ev.blueEveningStart = firstOf(low, false);
    const civ = at('civil');
    ev.civilDawn = firstOf(civ, true);
    ev.civilDusk = firstOf(civ, false);
    const nau = at('nautical');
    ev.nauticalDawn = firstOf(nau, true);
    ev.nauticalDusk = firstOf(nau, false);
    const ast = at('astronomical');
    ev.astroDawn = firstOf(ast, true);
    ev.astroDusk = firstOf(ast, false);

    let max = samples[0], min = samples[0];
    let above = 0;
    for (const s of samples) {
      if (s.v > max.v) max = s;
      if (s.v < min.v) min = s;
    }
    // Day length: integrate time above the horizon threshold, interpolating the edges.
    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1].v - THRESHOLDS.horizon;
      const b = samples[i].v - THRESHOLDS.horizon;
      if (a >= 0 && b >= 0) above += 1;
      else if (a >= 0 || b >= 0) above += a >= 0 ? a / (a - b) : b / (b - a);
    }
    ev.solarNoon = max.t;
    ev.noonAltitude = max.v;
    ev.solarMidnight = min.t;
    ev.dayLengthMin = above;
    ev.polar = hz.length ? null : (max.v > THRESHOLDS.horizon ? 'midnight-sun' : 'polar-night');
    ev.samples = samples;
    return ev;
  }

  /** Analytic day length (minutes) for a given local day — smooth & fast for the year curve. */
  function quickDayLength(start, lat, lng) {
    const c = sunCoords(toDays(start + 12 * 3600000));
    const phi = rad * lat;
    const sinH0 = sin(THRESHOLDS.horizon * rad);
    const cosH = (sinH0 - sin(phi) * sin(c.dec)) / (cos(phi) * cos(c.dec));
    if (cosH <= -1) return 1440;
    if (cosH >= 1) return 0;
    return (2 * acos(cosH) / rad) * 4;
  }

  function moonDay(start, end, lat, lng) {
    const samples = sample((t) => moonPosition(t, lat, lng).altitude, start, end, 5);
    const c = crossings(samples, 0.133);
    return {
      rise: firstOf(c, true),
      set: firstOf(c, false),
      alwaysUp: !c.length && samples[0].v > 0,
      alwaysDown: !c.length && samples[0].v <= 0,
    };
  }

  /** Next instant after `from` where the moon phase reaches `target` (0 = new, 0.5 = full). */
  function nextPhase(from, target) {
    const rel = (t) => {
      let x = moonIllumination(t).phase - target;
      x -= Math.round(x); // wrap to [-0.5, 0.5)
      return x;
    };
    let t = from;
    let prev = rel(t);
    const hour = 3600000;
    for (let i = 0; i < 24 * 32; i += 6) {
      const t2 = t + 6 * hour;
      const cur = rel(t2);
      if (prev < 0 && cur >= 0 && cur - prev < 0.5) {
        // bisection refine
        let lo = t, hi = t2;
        for (let k = 0; k < 20; k++) {
          const mid = (lo + hi) / 2;
          if (rel(mid) < 0) lo = mid; else hi = mid;
        }
        return hi;
      }
      t = t2;
      prev = cur;
    }
    return null;
  }

  /** Light phase for a given sun altitude. */
  function lightPhase(alt) {
    if (alt >= 6) return 'day';
    if (alt >= -4) return 'golden';
    if (alt >= -6) return 'blue';
    if (alt >= -12) return 'nautical';
    if (alt >= -18) return 'astronomical';
    return 'night';
  }

  function compass(az) {
    const pts = ['north', 'north-northeast', 'northeast', 'east-northeast', 'east', 'east-southeast',
      'southeast', 'south-southeast', 'south', 'south-southwest', 'southwest', 'west-southwest',
      'west', 'west-northwest', 'northwest', 'north-northwest'];
    return pts[Math.round(az / 22.5) % 16];
  }

  global.Astro = {
    rad, DAY_MS, SYNODIC_MONTH, THRESHOLDS,
    toDays, siderealTime, sunCoords, moonCoords, horizon,
    sunAltitude, sunPosition, moonPosition, moonIllumination, phaseName,
    zonedParts, tzOffset, zonedMidnight,
    sunDay, quickDayLength, moonDay, nextPhase, lightPhase, compass,
  };
})(typeof window !== 'undefined' ? window : globalThis);
