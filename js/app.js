/*
 * app.js — state, controls and all the prose for The Daylight Almanac.
 */
(function () {
  'use strict';
  const A = window.Astro;
  const U = window.SkyUtil;
  const $ = (id) => document.getElementById(id);

  const BROWSER_TZ = (Intl.DateTimeFormat().resolvedOptions().timeZone) || 'UTC';
  const STORE_KEY = 'daylight-almanac.place';

  const PLACES = [
    { id: 'jakarta', name: 'Jakarta', region: 'Indonesia', lat: -6.2088, lng: 106.8456, tz: 'Asia/Jakarta' },
    { id: 'bali', name: 'Denpasar', region: 'Bali', lat: -8.65, lng: 115.2167, tz: 'Asia/Makassar' },
    { id: 'singapore', name: 'Singapore', region: 'Singapore', lat: 1.3521, lng: 103.8198, tz: 'Asia/Singapore' },
    { id: 'tokyo', name: 'Tokyo', region: 'Japan', lat: 35.6762, lng: 139.6503, tz: 'Asia/Tokyo' },
    { id: 'quito', name: 'Quito', region: 'Ecuador, on the equator', lat: -0.1807, lng: -78.4678, tz: 'America/Guayaquil' },
    { id: 'london', name: 'London', region: 'United Kingdom', lat: 51.5074, lng: -0.1278, tz: 'Europe/London' },
    { id: 'newyork', name: 'New York', region: 'United States', lat: 40.7128, lng: -74.006, tz: 'America/New_York' },
    { id: 'capetown', name: 'Cape Town', region: 'South Africa', lat: -33.9249, lng: 18.4241, tz: 'Africa/Johannesburg' },
    { id: 'reykjavik', name: 'Reykjavík', region: 'Iceland', lat: 64.1466, lng: -21.9426, tz: 'Atlantic/Reykjavik' },
    { id: 'tromso', name: 'Tromsø', region: 'Norway, Arctic Circle', lat: 69.6492, lng: 18.9553, tz: 'Europe/Oslo' },
    { id: 'longyearbyen', name: 'Longyearbyen', region: 'Svalbard', lat: 78.2232, lng: 15.6267, tz: 'Arctic/Longyearbyen' },
    { id: 'ushuaia', name: 'Ushuaia', region: 'Argentina, end of the world', lat: -54.8019, lng: -68.303, tz: 'America/Argentina/Ushuaia' },
    { id: 'mcmurdo', name: 'McMurdo Station', region: 'Antarctica', lat: -77.846, lng: 166.676, tz: 'Antarctica/McMurdo' },
  ];

  const BAND = {
    night: '#0b0f22', astronomical: '#1a2148', nautical: '#2e3b77',
    blue: '#5470b4', golden: '#f2a654', day: '#f7e2ab',
  };
  const PHASE_LABEL = {
    night: 'Night', astronomical: 'Astronomical twilight', nautical: 'Nautical twilight',
    blue: 'Blue hour', golden: 'Golden hour', day: 'Daylight',
  };

  const state = {
    place: null, y: 0, m: 0, d: 0,
    minute: 0, live: true, playing: false, speed: 60,
    day: null, year: null, lastKey: '', moonKey: -1, hinted: false,
  };

  const sky = new window.Sky($('sky'));

  /* ---------- formatting ---------- */
  const fmtCache = new Map();
  function fmt(tz, opts) {
    const key = tz + JSON.stringify(opts);
    if (!fmtCache.has(key)) fmtCache.set(key, new Intl.DateTimeFormat('en-GB', { timeZone: tz, ...opts }));
    return fmtCache.get(key);
  }
  const tz = () => state.place.tz;
  const hhmm = (t) => (t == null ? '—' : fmt(tz(), { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(t));
  const shortDate = (t) => (t == null ? '—' : fmt(tz(), { weekday: 'short', day: 'numeric', month: 'short' }).format(t));
  const longDate = (t) => fmt(tz(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(t);
  function dur(min) {
    const m = Math.round(min);
    return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
  }
  function deltaStr(min) {
    const s = Math.round(min * 60);
    const sign = s > 0 ? '+' : s < 0 ? '−' : '±';
    const a = Math.abs(s);
    return `${sign}${Math.floor(a / 60)}m ${String(a % 60).padStart(2, '0')}s`;
  }
  const deg = (x, dp = 1) => `${Math.abs(x).toFixed(dp)}°`;
  const coordStr = (lat, lng) =>
    `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lng).toFixed(2)}°${lng >= 0 ? 'E' : 'W'}`;
  const COMPASS_SHORT = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const compassShort = (az) => COMPASS_SHORT[Math.round(az / 22.5) % 16];
  const shadowLen = (alt) => { const l = 1.7 / Math.tan(alt * Math.PI / 180); return l < 10 ? l.toFixed(1) : Math.round(l).toString(); };
  function roman(n) {
    const map = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
    let s = '';
    for (const [v, r] of map) while (n >= v) { s += r; n -= v; }
    return s;
  }
  const dayOfYear = (y, m, d) => Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 86400000);
  function utcOffsetLabel(t) {
    const off = A.tzOffset(tz(), t) / 60000;
    const sign = off >= 0 ? '+' : '−';
    const a = Math.abs(off);
    return `UTC${sign}${Math.floor(a / 60)}${a % 60 ? ':' + String(a % 60).padStart(2, '0') : ''}`;
  }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* ---------- places ---------- */
  function approxZone(lng) {
    const off = Math.max(-12, Math.min(14, Math.round(lng / 15)));
    return off === 0 ? 'Etc/GMT' : `Etc/GMT${off > 0 ? '-' : '+'}${Math.abs(off)}`; // Etc signs are inverted
  }

  function populatePlaces() {
    const sel = $('place');
    const opts = PLACES.map((p) => `<option value="${p.id}">${esc(p.name)}, ${esc(p.region)}</option>`);
    if (state.place && !PLACES.some((p) => p.id === state.place.id)) {
      opts.unshift(`<option value="${esc(state.place.id)}">${esc(state.place.name)}</option>`);
    }
    sel.innerHTML = opts.join('');
    sel.value = state.place.id;
  }

  function initialPlace() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      if (saved && typeof saved.lat === 'number' && typeof saved.lng === 'number' && saved.tz) {
        fmt(saved.tz, {}); // throws if the zone is unknown
        return saved;
      }
    } catch (_) { /* ignore */ }
    return PLACES.find((p) => p.tz === BROWSER_TZ) || PLACES[0];
  }

  function setPlace(place) {
    state.place = place;
    try { localStorage.setItem(STORE_KEY, JSON.stringify(place)); } catch (_) { /* ignore */ }
    populatePlaces();
    $('lat').value = place.lat.toFixed(4);
    $('lng').value = place.lng.toFixed(4);
    state.year = null;
    if (state.live) goLive(); else setDate(state.y, state.m, state.d);
  }

  /* ---------- date & time ---------- */
  function setDate(y, m, d, keepMinute = true) {
    const norm = new Date(Date.UTC(y, m - 1, d));
    state.y = norm.getUTCFullYear(); state.m = norm.getUTCMonth() + 1; state.d = norm.getUTCDate();
    const prevMinute = state.minute;
    computeDay();
    state.minute = keepMinute ? Math.min(prevMinute, state.day.lengthMin - 0.01) : 0;
    $('date').value = `${state.y}-${String(state.m).padStart(2, '0')}-${String(state.d).padStart(2, '0')}`;
    state.lastKey = '';
  }

  function shiftDay(n) { setDate(state.y, state.m, state.d + n); }

  function goLive() {
    state.live = true;
    setPlaying(false);
    const now = Date.now();
    const p = A.zonedParts(tz(), now);
    setDate(p.y, p.m, p.d);
    state.minute = (now - state.day.start) / 60000;
    state.lastKey = '';
  }

  function leaveLive() { state.live = false; }

  function setPlaying(on) {
    state.playing = on;
    document.body.classList.toggle('is-playing', on);
    $('play').setAttribute('aria-label', on ? 'Pause' : 'Play the day');
    if (on) leaveLive();
  }

  const instant = () => state.day.start + state.minute * 60000;

  /* ---------- per-day computation ---------- */
  function computeDay() {
    const { lat, lng } = state.place;
    const start = A.zonedMidnight(state.y, state.m, state.d, tz());
    const end = A.zonedMidnight(state.y, state.m, state.d + 1, tz());
    const prevStart = A.zonedMidnight(state.y, state.m, state.d - 1, tz());
    const sun = A.sunDay(start, end, lat, lng);
    const prev = A.sunDay(prevStart, start, lat, lng);
    const moon = A.moonDay(start, end, lat, lng);
    const path = [];
    for (let t = start; t <= end; t += 600000) {
      const p = A.sunPosition(t, lat, lng);
      path.push({ az: p.azimuth, alt: p.altitude });
    }
    sky.setSunPath(path);
    state.day = {
      start, end, sun, prev, moon,
      lengthMin: Math.round((end - start) / 60000),
      nextFull: A.nextPhase(start, 0.5),
      nextNew: A.nextPhase(start, 0),
    };
    $('time').max = state.day.lengthMin - 1;
    state.moonKey = -1;
    renderMasthead();
    renderBand();
    renderPins();
    renderSun();
    renderLight();
    renderMoonLedger();
    ensureYear();
    placeYearMarker();
  }

  /* ---------- static (per-day) renders ---------- */
  function renderMasthead() {
    const { y, m, d, place, day } = state;
    $('vol').textContent = roman(y);
    $('issue').textContent = dayOfYear(y, m, d) + 1;
    $('edition').textContent = `${place.name} Edition · ${coordStr(place.lat, place.lng)}`;
    $('longdate').textContent = longDate(day.start + 12 * 3600000);
    $('facing').textContent = place.lat >= 0 ? 'Facing south · east is on your left' : 'Facing north · east is on your right';
  }

  function renderBand() {
    const { samples } = state.day.sun;
    const n = samples.length - 1;
    const stops = [];
    let cur = A.lightPhase(samples[0].v);
    let from = 0;
    for (let i = 1; i <= n; i++) {
      const ph = i === n ? null : A.lightPhase(samples[i].v);
      if (ph !== cur) {
        const a = (from / n) * 100, b = (i / n) * 100;
        stops.push(`${BAND[cur]} ${a.toFixed(3)}%`, `${BAND[cur]} ${b.toFixed(3)}%`);
        cur = ph; from = i;
      }
    }
    $('band').style.background = `linear-gradient(90deg, ${stops.join(', ')})`;
  }

  function renderPins() {
    const { start, end, sun, moon } = state.day;
    const pos = (t) => ((t - start) / (end - start)) * 100;
    const pins = [];
    const add = (t, cls, label) => {
      if (t == null) return;
      pins.push(`<span class="pin ${cls}" style="left:${pos(t).toFixed(2)}%"><b>${label}</b><em>${hhmm(t)}</em></span>`);
    };
    add(sun.sunrise, 'pin-rise', 'Sunrise');
    if (sun.noonAltitude > -0.833) add(sun.solarNoon, 'pin-noon', 'Noon');
    add(sun.sunset, 'pin-set', 'Sunset');
    add(moon.rise, 'pin-moon', 'Moonrise');
    add(moon.set, 'pin-moon', 'Moonset');
    $('pins').innerHTML = pins.join('');
  }

  function ledger(el, rows) {
    el.innerHTML = rows.map(([k, v, note]) =>
      `<div class="row"><dt>${k}</dt><dd>${v}${note ? `<small>${note}</small>` : ''}</dd></div>`).join('');
  }

  function renderSun() {
    const { sun, prev } = state.day;
    const { lat, lng } = state.place;
    const bearing = (t) => (t == null ? '' : `bearing ${Math.round(A.sunPosition(t, lat, lng).azimuth)}° ${compassShort(A.sunPosition(t, lat, lng).azimuth)}`);
    let darkMin = 0;
    for (const s of sun.samples) if (s.v < -18) darkMin++;
    ledger($('sunLedger'), [
      ['Sunrise', hhmm(sun.sunrise), bearing(sun.sunrise)],
      ['Solar noon', hhmm(sun.solarNoon), `${sun.noonAltitude.toFixed(1)}° above the horizon`],
      ['Sunset', hhmm(sun.sunset), bearing(sun.sunset)],
      ['Day length', dur(sun.dayLengthMin), sun.polar ? '' : `${deltaStr(sun.dayLengthMin - prev.dayLengthMin)} on yesterday`],
      ['True darkness', darkMin ? dur(darkMin) : 'none', darkMin ? 'sun below −18°' : 'the sky never gets fully dark'],
    ]);
    let foot;
    if (sun.polar === 'midnight-sun') foot = 'Midnight sun. It circles the sky all day without setting.';
    else if (sun.polar === 'polar-night') foot = `Polar night. At its highest the sun is still ${deg(sun.noonAltitude)} below the horizon.`;
    else {
      const diff = sun.dayLengthMin - prev.dayLengthMin;
      foot = Math.abs(diff) < 0.25
        ? 'The days here are barely changing length at the moment.'
        : `The days are getting ${diff > 0 ? 'longer' : 'shorter'} by about ${Math.abs(diff * 60).toFixed(0)} seconds a day.`;
    }
    $('sunFoot').textContent = foot;
  }

  function span(a, b) {
    if (a == null && b == null) return '<span class="none">doesn’t happen</span>';
    return `${hhmm(a)}<i>–</i>${hhmm(b)}`;
  }

  function renderLight() {
    const s = state.day.sun;
    const li = (cls, label, val) => `<li><span class="sp-label"><i class="sw sw-${cls}"></i>${label}</span><span class="sp-time">${val}</span></li>`;
    const single = (t) => (t == null ? '<span class="none">doesn’t happen</span>' : hhmm(t));

    // Near the poles the sun may enter blue or golden hour without ever leaving it at the top;
    // split those continuous midday windows cleanly at solar noon instead of showing half-dashes.
    const blueContinuous = s.civilDawn != null && s.civilDusk != null && s.blueMorningEnd == null && s.blueEveningStart == null;
    const goldContinuous = s.blueMorningEnd != null && s.blueEveningStart != null && s.goldenMorningEnd == null && s.goldenEveningStart == null;

    const blueMorning = blueContinuous ? span(s.civilDawn, s.solarNoon) : span(s.civilDawn, s.blueMorningEnd);
    const blueEvening = blueContinuous ? span(s.solarNoon, s.civilDusk) : span(s.blueEveningStart, s.civilDusk);
    const goldMorning = goldContinuous ? span(s.blueMorningEnd, s.solarNoon) : span(s.blueMorningEnd, s.goldenMorningEnd);
    const goldEvening = goldContinuous ? span(s.solarNoon, s.blueEveningStart) : span(s.goldenEveningStart, s.blueEveningStart);

    $('lightMorning').innerHTML = [
      li('astronomical', 'Astronomical dawn', single(s.astroDawn)),
      li('nautical', 'Nautical dawn', single(s.nauticalDawn)),
      li('blue', 'Blue hour', blueMorning),
      li('golden', 'Golden hour', goldMorning),
      li('day', 'Sunrise', single(s.sunrise)),
    ].join('');
    $('lightEvening').innerHTML = [
      li('day', 'Sunset', single(s.sunset)),
      li('golden', 'Golden hour', goldEvening),
      li('blue', 'Blue hour', blueEvening),
      li('nautical', 'Nautical dusk', single(s.nauticalDusk)),
      li('astronomical', 'Astronomical dusk', single(s.astroDusk)),
    ].join('');
  }

  function renderMoonLedger() {
    const { moon, nextFull, nextNew } = state.day;
    const rise = moon.rise != null ? hhmm(moon.rise) : (moon.alwaysUp ? 'up all day' : '—');
    const set = moon.set != null ? hhmm(moon.set) : (moon.alwaysDown ? 'down all day' : '—');
    ledger($('moonLedger'), [
      ['Moonrise', rise],
      ['Moonset', set],
      ['Next full moon', shortDate(nextFull)],
      ['Next new moon', shortDate(nextNew)],
    ]);
  }

  function renderMoonCard(illum, moonPos) {
    const key = Math.round(illum.phase * 400);
    if (key === state.moonKey) return;
    state.moonKey = key;
    $('moonLit').setAttribute('d', U.moonSvgPath(illum.phase));
    $('moonFlip').setAttribute('transform', state.place.lat < 0 ? 'translate(100 0) scale(-1 1)' : '');
    $('moonPhase').textContent = A.phaseName(illum.phase);
    $('moonSub').textContent =
      `${Math.round(illum.fraction * 100)}% lit · ${illum.age.toFixed(1)} days old · ${Math.round(moonPos.distance).toLocaleString('en-US')} km away`;
  }

  /* ---------- the year curve ---------- */
  const YC = { W: 760, H: 220, L: 40, R: 12, T: 14, B: 28 };
  function ensureYear() {
    const { place, y } = state;
    const key = `${place.lat}|${place.lng}|${place.tz}|${y}`;
    if (state.year && state.year.key === key) return;
    const n = dayOfYear(y, 12, 31) + 1;
    const data = new Array(n);
    for (let i = 0; i < n; i++) {
      // Approximate local solar midnight (noon is computed +12h inside quickDayLength)
      const s = Date.UTC(y, 0, 1 + i) - place.lng * 240000;
      data[i] = A.quickDayLength(s, place.lat, place.lng);
    }
    state.year = { key, data, y };
    renderYear();
  }

  function renderYear() {
    const { data, y } = state.year;
    const { W, H, L, R, T, B } = YC;
    const pw = W - L - R, ph = H - T - B, n = data.length;
    const x = (i) => L + (i / (n - 1)) * pw;
    const yy = (min) => T + ph - (min / 1440) * ph;
    let out = `<defs><linearGradient id="yFill" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" class="yf-a"/><stop offset="100%" class="yf-b"/></linearGradient></defs>`;
    for (const h of [0, 6, 12, 18, 24]) {
      out += `<line class="yg" x1="${L}" x2="${W - R}" y1="${yy(h * 60)}" y2="${yy(h * 60)}"/>`;
      out += `<text class="yl" x="${L - 8}" y="${yy(h * 60) + 3.5}" text-anchor="end">${h}h</text>`;
    }
    const months = 'JFMAMJJASOND';
    for (let m = 0; m < 12; m++) {
      const i0 = dayOfYear(y, m + 1, 1);
      const i1 = dayOfYear(y, m + 2, 1);
      if (m > 0) out += `<line class="ym" x1="${x(i0)}" x2="${x(i0)}" y1="${T}" y2="${T + ph}"/>`;
      out += `<text class="yl" x="${x((i0 + Math.min(i1, n - 1)) / 2)}" y="${H - 8}" text-anchor="middle">${months[m]}</text>`;
    }
    let line = '';
    data.forEach((v, i) => { line += `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${yy(v).toFixed(1)} `; });
    out += `<path class="yarea" d="${line} L${x(n - 1)} ${yy(0)} L${x(0)} ${yy(0)} Z"/>`;
    out += `<path class="yline" d="${line}"/>`;
    out += `<g id="yHover" class="yhover" style="display:none"><line y1="${T}" y2="${T + ph}"/></g>`;
    out += `<g id="yMarker" class="ymarker"><line y1="${T}" y2="${T + ph}"/><circle r="5"/></g>`;
    const svg = $('yearChart');
    svg.innerHTML = out;

    const maxI = data.indexOf(Math.max(...data));
    const minI = data.indexOf(Math.min(...data));
    const range = data[maxI] - data[minI];
    const dateOf = (i) => new Date(Date.UTC(y, 0, 1 + i)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
    let foot;
    if (data[maxI] >= 1440 || data[minI] <= 0) {
      const up = data.filter((v) => v >= 1440).length;
      const down = data.filter((v) => v <= 0).length;
      foot = `${up ? `${up} days of midnight sun` : ''}${up && down ? ' and ' : ''}${down ? `${down} days of polar night` : ''} in ${y}. Click anywhere on the curve to jump to that date.`;
    } else if (range < 60) {
      foot = `Close to the equator the length of the day hardly changes: it varies by only ${Math.round(range)} minutes across ${y}. Try Tromsø for comparison.`;
    } else {
      foot = `Longest day: ${dateOf(maxI)} (${dur(data[maxI])}). Shortest: ${dateOf(minI)} (${dur(data[minI])}). Click the curve to jump to a date.`;
    }
    $('yearFoot').textContent = foot;
  }

  function placeYearMarker() {
    if (!state.year || state.year.y !== state.y) return;
    const { W, L, R, T, B, H } = YC;
    const n = state.year.data.length;
    const i = dayOfYear(state.y, state.m, state.d);
    const x = L + (i / (n - 1)) * (W - L - R);
    const y = T + (H - T - B) - (state.year.data[i] / 1440) * (H - T - B);
    const g = $('yMarker');
    if (!g) return;
    g.querySelector('line').setAttribute('x1', x);
    g.querySelector('line').setAttribute('x2', x);
    const c = g.querySelector('circle');
    c.setAttribute('cx', x); c.setAttribute('cy', y);
  }

  function yearIndexFromEvent(e) {
    const svg = $('yearChart');
    const r = svg.getBoundingClientRect();
    const sx = ((e.clientX - r.left) / r.width) * YC.W;
    const n = state.year.data.length;
    const i = Math.round(((sx - YC.L) / (YC.W - YC.L - YC.R)) * (n - 1));
    return { i: Math.max(0, Math.min(n - 1, i)), r, sx };
  }

  /* ---------- live / per-frame renders ---------- */
  function composeNote(t, sun, moon, illum) {
    const place = state.place.name;
    const alt = sun.altitude;
    const dir = A.compass(sun.azimuth);
    const ev = state.day.sun;
    const ph = A.lightPhase(alt);
    let s;
    switch (ph) {
      case 'night':
        s = `It's fully dark in ${place}. The sun is ${deg(alt)} below the horizon, too far down to leave any glow in the sky.`; break;
      case 'astronomical':
        s = `Astronomical twilight. The sun is ${deg(alt)} down. To most people the sky over ${place} looks black, but the faintest stars are already being washed out.`; break;
      case 'nautical':
        s = `Nautical twilight. With the sun ${deg(alt)} down, the horizon line is visible again. Sailors once used this window to take star sightings against it.`; break;
      case 'blue':
        s = `Blue hour. The sun is ${deg(alt)} below the horizon, so ${place} only gets light scattered by the upper air and everything turns a cool cobalt.`; break;
      case 'golden':
        s = alt > 0
          ? `Golden hour. The sun is only ${deg(alt)} up in the ${dir}. Its light crosses so much air that the blue gets scattered away, which leaves warm light and long shadows.`
          : `The sun has just gone below the ${dir} horizon (${deg(alt)} down), but it is still lighting the undersides of the clouds over ${place}.`;
        break;
      default: {
        const nearNoon = Math.abs(t - ev.solarNoon) < 40 * 60000;
        s = alt > 84
          ? `The sun is almost straight overhead in ${place} (${deg(alt)} up), and shadows have shrunk to almost nothing.`
          : `It's broad daylight. The sun is ${deg(alt)} up in the ${dir}${nearNoon ? ', close to its highest point of the day' : ''}.`;
      }
    }
    const lit = Math.round(illum.fraction * 100);
    if (alt < -4) {
      if (moon.altitude > 0) s += ` The moon is ${lit}% lit and sits ${deg(moon.altitude)} above the ${A.compass(moon.azimuth)} horizon.`;
      else if (alt < -12) s += ' The moon is below the horizon, so it\u2019s a good night for stars.';
    } else if (alt > 6 && moon.altitude > 10 && illum.fraction > 0.2) {
      s += ` Look ${A.compass(moon.azimuth)} and you'll see the moon up in daylight, ${lit}% lit.`;
    }
    if (alt > 2 && alt <= 84) s += ` A person 1.7 m tall casts a ${shadowLen(alt)} m shadow.`;
    if (ev.polar === 'midnight-sun') s += ` The sun won't set in ${place} today.`;
    if (ev.polar === 'polar-night') s += ` The sun won't rise in ${place} today.`;
    return s;
  }

  function updateDom(t, sun, moon, illum) {
    const parts = A.zonedParts(tz(), t);
    const hm = `${String(parts.h).padStart(2, '0')}:${String(parts.min).padStart(2, '0')}`;
    $('clockTime').innerHTML = state.live ? `${hm}<span class="sec">:${String(parts.s).padStart(2, '0')}</span>` : hm;
    const zoneName = state.place.zoneNote || state.place.tz.replace(/_/g, ' ');
    $('clockMeta').textContent = `${state.live ? 'Live' : 'Local time'} · ${zoneName} · ${utcOffsetLabel(t)}`;

    const ph = A.lightPhase(sun.altitude);
    $('phaseName').textContent = PHASE_LABEL[ph];
    document.body.dataset.phase = ph;
    const theme = sun.altitude < -4 ? 'night' : 'day';
    if (document.body.dataset.theme !== theme) {
      document.body.dataset.theme = theme;
      document.querySelector('meta[name="theme-color"]').setAttribute('content', theme === 'night' ? '#0c0f1f' : '#f3ede1');
    }

    $('roSun').textContent = `${sun.altitude >= 0 ? '' : '−'}${deg(sun.altitude)} · ${compassShort(sun.azimuth)} ${Math.round(sun.azimuth)}°`;
    $('roMoon').textContent = moon.altitude > 0
      ? `${deg(moon.altitude)} · ${compassShort(moon.azimuth)} ${Math.round(moon.azimuth)}°`
      : 'below horizon';
    $('roShadow').textContent =
      sun.altitude > 0.5 && sun.altitude <= 89.5 ? `${shadowLen(sun.altitude)} m for 1.7 m`
      : sun.altitude > 0 && sun.altitude <= 0.5 ? '> 190 m (very long)'
      : 'none';

    const slider = $('time');
    if (document.activeElement !== slider || state.live || state.playing) slider.value = Math.floor(state.minute);
    slider.setAttribute('aria-valuetext', `${hm}, ${PHASE_LABEL[ph]}`);
    $('live').classList.toggle('on', state.live);

    $('note').textContent = composeNote(t, sun, moon, illum);
    renderMoonCard(illum, moon);
  }

  let lastFrame = performance.now();
  function frame(now) {
    const dt = Math.min(100, now - lastFrame);
    lastFrame = now;
    if (state.live) {
      const t = Date.now();
      if (t >= state.day.end || t < state.day.start) goLive();
      state.minute = (Date.now() - state.day.start) / 60000;
    } else if (state.playing) {
      state.minute += (state.speed * dt) / 1000;
      if (state.minute >= state.day.lengthMin) {
        const over = state.minute - state.day.lengthMin;
        setDate(state.y, state.m, state.d + 1);
        state.minute = over;
      }
    }
    const t = instant();
    const { lat, lng } = state.place;
    const sun = A.sunPosition(t, lat, lng);
    const moon = A.moonPosition(t, lat, lng);
    const illum = A.moonIllumination(t);
    sky.draw({ t, lat, lng, sun, moon, illum }, now);

    const key = state.live ? `L${Math.floor(t / 1000)}` : `S${state.y}${state.m}${state.d}:${Math.floor(state.minute)}`;
    if (key !== state.lastKey) {
      state.lastKey = key;
      updateDom(t, sun, moon, illum);
      if (document.body.classList.contains('no-trans')) {
        requestAnimationFrame(() => document.body.classList.remove('no-trans'));
      }
    }
    requestAnimationFrame(frame);
  }

  /* ---------- wiring ---------- */
  function bind() {
    $('place').addEventListener('change', (e) => {
      const p = PLACES.find((x) => x.id === e.target.value);
      if (p) setPlace({ ...p });
    });

    $('applyCoords').addEventListener('click', () => {
      const lat = parseFloat($('lat').value), lng = parseFloat($('lng').value);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
        $('coordsCtl').classList.add('bad');
        setTimeout(() => $('coordsCtl').classList.remove('bad'), 900);
        return;
      }
      const z = approxZone(lng);
      setPlace({ id: 'custom', name: coordStr(lat, lng), lat, lng, tz: z, zoneNote: `solar zone ${z.replace('Etc/', '')}` });
    });
    ['lat', 'lng'].forEach((id) => $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') $('applyCoords').click(); }));

    $('locate').addEventListener('click', () => {
      if (!navigator.geolocation) return;
      const btn = $('locate');
      btn.classList.add('busy');
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          btn.classList.remove('busy');
          const { latitude: lat, longitude: lng } = pos.coords;
          setPlace({ id: 'here', name: 'Your location', lat, lng, tz: BROWSER_TZ });
        },
        () => { btn.classList.remove('busy'); btn.classList.add('denied'); setTimeout(() => btn.classList.remove('denied'), 1500); },
        { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 }
      );
    });

    $('date').addEventListener('change', (e) => {
      const [y, m, d] = e.target.value.split('-').map(Number);
      if (!y) return;
      leaveLive();
      setDate(y, m, d);
    });
    $('prevDay').addEventListener('click', () => { leaveLive(); shiftDay(-1); });
    $('nextDay').addEventListener('click', () => { leaveLive(); shiftDay(1); });

    $('time').addEventListener('input', (e) => {
      leaveLive();
      setPlaying(false);
      state.minute = +e.target.value;
    });
    $('play').addEventListener('click', () => setPlaying(!state.playing));
    $('live').addEventListener('click', goLive);
    $('speed').addEventListener('change', (e) => { state.speed = +e.target.value; });

    // drag the sky to scrub
    const canvas = $('sky');
    let drag = null;
    canvas.addEventListener('pointerdown', (e) => {
      drag = { x: e.clientX, m: state.minute };
      canvas.setPointerCapture(e.pointerId);
      canvas.classList.add('dragging');
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dir = state.place.lat >= 0 ? 1 : -1;
      const dx = (e.clientX - drag.x) * dir;
      leaveLive();
      setPlaying(false);
      state.minute = Math.max(0, Math.min(state.day.lengthMin - 0.01, drag.m + (dx / canvas.clientWidth) * 720));
      if (!state.hinted) { state.hinted = true; $('hint').classList.add('gone'); }
    });
    const end = () => { drag = null; canvas.classList.remove('dragging'); };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);

    // year chart
    const svg = $('yearChart');
    svg.addEventListener('pointermove', (e) => {
      if (!state.year) return;
      const { i, r } = yearIndexFromEvent(e);
      const n = state.year.data.length;
      const x = YC.L + (i / (n - 1)) * (YC.W - YC.L - YC.R);
      const hov = $('yHover');
      hov.style.display = '';
      hov.querySelector('line').setAttribute('x1', x);
      hov.querySelector('line').setAttribute('x2', x);
      const tip = $('yearTip');
      tip.hidden = false;
      const date = new Date(Date.UTC(state.year.y, 0, 1 + i));
      tip.innerHTML = `<b>${date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })}</b> ${dur(state.year.data[i])}`;
      const px = (x / YC.W) * r.width;
      tip.style.left = `${Math.max(40, Math.min(r.width - 40, px))}px`;
    });
    svg.addEventListener('pointerleave', () => {
      const hov = $('yHover');
      if (hov) hov.style.display = 'none';
      $('yearTip').hidden = true;
    });
    svg.addEventListener('click', (e) => {
      if (!state.year) return;
      const { i } = yearIndexFromEvent(e);
      leaveLive();
      setDate(state.year.y, 1, 1 + i);
    });

    // keyboard
    window.addEventListener('keydown', (e) => {
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'select' || tag === 'textarea' || e.metaKey || e.ctrlKey || e.altKey) return;
      const step = e.shiftKey ? 60 : 5;
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        leaveLive();
        setPlaying(false);
        const dm = e.key === 'ArrowRight' ? step : -step;
        state.minute = Math.max(0, Math.min(state.day.lengthMin - 0.01, state.minute + dm));
      } else if (e.key === ' ') {
        if (tag === 'button') return;
        e.preventDefault();
        setPlaying(!state.playing);
      } else if (e.key === 'n' || e.key === 'N') {
        goLive();
      } else if (e.key === '[') {
        leaveLive(); shiftDay(-1);
      } else if (e.key === ']') {
        leaveLive(); shiftDay(1);
      }
    });
  }

  /* ---------- boot ---------- */
  state.place = initialPlace();
  populatePlaces();
  $('lat').value = state.place.lat.toFixed(4);
  $('lng').value = state.place.lng.toFixed(4);
  bind();
  goLive();
  requestAnimationFrame(frame);
})();
