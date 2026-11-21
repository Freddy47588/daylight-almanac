/*
 * sky.js — paints a physically-driven panorama of the sky.
 *
 * Everything on the canvas is placed by real astronomy: the sun, the moon
 * (with its actual phase), ~25 named bright stars plus a seeded field of
 * faint ones that wheel around the celestial pole as you scrub time.
 * The horizontal axis is a full 360° panorama centred on the equator-facing
 * direction (south in the northern hemisphere, north in the southern).
 */
(function (global) {
  'use strict';
  const A = global.Astro;
  const rad = Math.PI / 180;

  /* ---------- colour helpers ---------- */
  const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const rgb = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };

  // Sky palette keyed by solar altitude: [alt, zenith, mid, horizon]
  const PALETTE = [
    [-90, '#03040a', '#05070f', '#080b18'],
    [-18, '#04060f', '#070b1a', '#0d1226'],
    [-12, '#070c24', '#0f1838', '#1f2650'],
    [-8, '#0f1a44', '#22306a', '#4a3f78'],
    [-5, '#1a2a62', '#3b4a8c', '#a0688c'],
    [-2, '#26407e', '#5a6aa6', '#ec8d5c'],
    [0, '#2f4f92', '#7486b8', '#ffa15c'],
    [3, '#3a63a8', '#8fa6cf', '#ffc27e'],
    [8, '#3d72bd', '#88b3dd', '#f6dcb6'],
    [20, '#2f74c8', '#79b4e6', '#c9e3f4'],
    [50, '#2468bf', '#6aaae6', '#b5daf5'],
    [90, '#1f5fb8', '#62a3e3', '#acd5f4'],
  ].map(([a, z, m, h]) => [a, hex(z), hex(m), hex(h)]);

  function skyColors(alt) {
    for (let i = 1; i < PALETTE.length; i++) {
      if (alt <= PALETTE[i][0]) {
        const p = PALETTE[i - 1], q = PALETTE[i];
        const t = (alt - p[0]) / (q[0] - p[0]);
        return { zenith: mix(p[1], q[1], t), mid: mix(p[2], q[2], t), horizon: mix(p[3], q[3], t) };
      }
    }
    const l = PALETTE[PALETTE.length - 1];
    return { zenith: l[1], mid: l[2], horizon: l[3] };
  }

  /* ---------- deterministic randomness ---------- */
  function rng(seed) {
    return () => {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Named bright stars — J2000 RA/Dec in degrees, visual magnitude.
  const NAMED = [
    ['Sirius', 101.287, -16.716, -1.46], ['Canopus', 95.988, -52.696, -0.74],
    ['Rigil Kentaurus', 219.902, -60.834, -0.27], ['Arcturus', 213.915, 19.182, -0.05],
    ['Vega', 279.235, 38.784, 0.03], ['Capella', 79.172, 45.998, 0.08],
    ['Rigel', 78.634, -8.202, 0.13], ['Procyon', 114.825, 5.225, 0.34],
    ['Achernar', 24.429, -57.237, 0.46], ['Betelgeuse', 88.793, 7.407, 0.5],
    ['Hadar', 210.956, -60.373, 0.61], ['Altair', 297.696, 8.868, 0.76],
    ['Acrux', 186.65, -63.099, 0.76], ['Aldebaran', 68.98, 16.509, 0.86],
    ['Antares', 247.352, -26.432, 0.96], ['Spica', 201.298, -11.161, 0.97],
    ['Pollux', 116.329, 28.026, 1.14], ['Fomalhaut', 344.413, -29.622, 1.16],
    ['Deneb', 310.358, 45.28, 1.25], ['Mimosa', 191.93, -59.689, 1.25],
    ['Regulus', 152.093, 11.967, 1.35], ['Gacrux', 187.791, -57.113, 1.63],
    ['Bellatrix', 81.283, 6.35, 1.64], ['Alnilam', 84.053, -1.202, 1.69],
    ['Alnitak', 85.19, -1.943, 1.77], ['Polaris', 37.955, 89.264, 1.98],
    ['Saiph', 86.939, -9.67, 2.06], ['Mintaka', 83.002, -0.299, 2.23],
    ['Imai', 183.786, -58.749, 2.79],
  ].map(([name, ra, dec, mag]) => ({ name, ra: ra * rad, dec: dec * rad, mag, named: true }));

  const LABELLED = new Set(['Sirius', 'Canopus', 'Arcturus', 'Vega', 'Capella', 'Rigel', 'Betelgeuse',
    'Antares', 'Polaris', 'Acrux', 'Altair', 'Aldebaran', 'Spica', 'Deneb', 'Fomalhaut', 'Rigil Kentaurus']);

  const FIELD = (() => {
    const r = rng(20261121);
    const stars = [];
    for (let i = 0; i < 700; i++) {
      stars.push({
        ra: r() * Math.PI * 2,
        dec: Math.asin(r() * 2 - 1),
        mag: 2.6 + Math.pow(r(), 0.6) * 3.6,
        tw: r() * Math.PI * 2,
        warm: r(),
      });
    }
    return stars;
  })();

  /* ---------- the renderer ---------- */
  class Sky {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.w = 0; this.h = 0; this.dpr = 1;
      this.hills = [];
      this.clouds = [];
      this.sunPath = null;
      this.resize();
      new ResizeObserver(() => this.resize()).observe(canvas);
    }

    resize() {
      const r = this.canvas.getBoundingClientRect();
      this.dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.w = Math.max(1, r.width);
      this.h = Math.max(1, r.height);
      this.canvas.width = Math.round(this.w * this.dpr);
      this.canvas.height = Math.round(this.h * this.dpr);
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this.horizonY = this.h * 0.74;
      this.buildHills();
      this.buildClouds();
    }

    buildHills() {
      const r = rng(7);
      this.hills = [0, 1, 2].map((layer) => {
        const waves = Array.from({ length: 5 }, (_, i) => ({
          f: (i + 1) * (1.2 + r() * 1.8) * (layer + 1) * 0.6,
          a: (1 / (i + 1)) * (0.6 + r() * 0.6),
          p: r() * Math.PI * 2,
        }));
        const pts = [];
        const n = 160;
        for (let i = 0; i <= n; i++) {
          const x = i / n;
          let y = 0;
          for (const w of waves) y += Math.sin(x * Math.PI * 2 * w.f + w.p) * w.a;
          pts.push(y);
        }
        const peak = Math.max(...pts.map(Math.abs)) || 1;
        // Far ridge hugs the horizon; nearer ridges sit lower so the sun sets
        // (roughly) where the maths says it does.
        return { pts: pts.map((p) => p / peak), amp: [9, 12, 16][layer], lift: [5, -10, -28][layer] };
      });
    }

    buildClouds() {
      const r = rng(42);
      this.clouds = Array.from({ length: 7 }, () => ({
        x: r(),
        y: 0.12 + r() * 0.42,
        s: 0.6 + r() * 1.1,
        v: 0.000004 + r() * 0.000006,
        puffs: Array.from({ length: 6 }, () => ({ dx: (r() - 0.5) * 2.6, dy: (r() - 0.5) * 0.5, r: 0.5 + r() * 0.7 })),
      }));
    }

    /* azimuth/altitude → canvas coordinates */
    project(az, alt) {
      let d = az - this.centerAz;
      d = ((d + 540) % 360) - 180; // [-180, 180)
      const x = this.w / 2 + (d / 180) * (this.w / 2);
      const y = this.horizonY - (alt / 90) * this.horizonY * 0.92;
      return { x, y };
    }

    setSunPath(points) { this.sunPath = points; }

    /**
     * @param {object} s  { t (ms), lat, lng, sun{altitude,azimuth}, moon{altitude,azimuth}, illum{phase,fraction} }
     * @param {number} now performance clock, for twinkle/clouds only
     */
    draw(s, now) {
      const { ctx, w, h } = this;
      const hy = this.horizonY;
      this.centerAz = s.lat >= 0 ? 180 : 0;
      const alt = s.sun.altitude;
      const col = skyColors(alt);
      const daylight = smooth(-8, 6, alt);
      const sunP = this.project(s.sun.azimuth, alt);

      // 1. sky gradient (fill full height so no stale pixels ever peek under low hill valleys)
      const g = ctx.createLinearGradient(0, 0, 0, hy);
      g.addColorStop(0, rgb(col.zenith));
      g.addColorStop(0.62, rgb(col.mid));
      g.addColorStop(1, rgb(col.horizon));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);

      // 2. horizon glow toward the sun (strongest around sunrise/sunset)
      const glowStrength = Math.exp(-Math.pow((alt + 1.5) / 7, 2));
      if (glowStrength > 0.01) {
        const gx = sunP.x;
        const rg = ctx.createRadialGradient(gx, hy, 0, gx, hy, w * 0.55);
        rg.addColorStop(0, `rgba(255,150,80,${0.55 * glowStrength})`);
        rg.addColorStop(0.35, `rgba(255,110,90,${0.22 * glowStrength})`);
        rg.addColorStop(1, 'rgba(255,100,120,0)');
        ctx.fillStyle = rg;
        ctx.fillRect(0, 0, w, hy + 2);
        // the anti-twilight "belt of Venus" on the opposite side
        const ox = sunP.x > w / 2 ? sunP.x - w / 2 : sunP.x + w / 2;
        const bg = ctx.createRadialGradient(ox, hy, 0, ox, hy, w * 0.45);
        bg.addColorStop(0, `rgba(230,140,170,${0.18 * glowStrength})`);
        bg.addColorStop(1, 'rgba(230,140,170,0)');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, w, hy + 2);
      }

      // 3. stars (real positions, fading in with darkness)
      const starVis = clamp((-alt - 3) / 13);
      this.starLabels = [];
      if (starVis > 0.01) {
        const d = A.toDays(s.t);
        const lst = A.siderealTime(d, -s.lng * rad);
        const phi = s.lat * rad;
        const sinPhi = Math.sin(phi), cosPhi = Math.cos(phi);
        const drawStar = (st, faint) => {
          const H = lst - st.ra;
          const sd = Math.sin(st.dec), cd = Math.cos(st.dec);
          const sinAlt = sinPhi * sd + cosPhi * cd * Math.cos(H);
          if (sinAlt < 0.01) return;
          const a = Math.asin(sinAlt) / rad;
          const az = (Math.atan2(Math.sin(H), Math.cos(H) * sinPhi - Math.tan(st.dec) * cosPhi) / rad + 540) % 360;
          const p = this.project(az, a);
          // atmospheric extinction near the horizon
          const ext = smooth(0, 14, a);
          const bright = clamp((6.4 - st.mag) / 7.5);
          const tw = faint ? 0.75 + 0.25 * Math.sin(now * 0.002 + st.tw) : 1;
          const alpha = starVis * ext * bright * tw;
          if (alpha < 0.02) return;
          const size = faint ? 0.5 + bright * 1.1 : 1.1 + bright * 2.2;
          if (!faint) {
            const halo = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, size * 5);
            halo.addColorStop(0, `rgba(220,230,255,${0.35 * alpha})`);
            halo.addColorStop(1, 'rgba(220,230,255,0)');
            ctx.fillStyle = halo;
            ctx.fillRect(p.x - size * 5, p.y - size * 5, size * 10, size * 10);
            if (LABELLED.has(st.name) && a > 6) this.starLabels.push({ ...p, name: st.name, alpha });
          }
          ctx.fillStyle = faint
            ? (st.warm > 0.8 ? `rgba(255,220,190,${alpha})` : `rgba(225,235,255,${alpha})`)
            : `rgba(255,255,255,${alpha})`;
          ctx.beginPath();
          ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
          ctx.fill();
        };
        for (const st of FIELD) drawStar(st, true);
        for (const st of NAMED) drawStar(st, false);
        ctx.font = '500 10px "IBM Plex Mono", ui-monospace, monospace';
        ctx.textAlign = 'left';
        for (const l of this.starLabels) {
          ctx.fillStyle = `rgba(200,210,240,${0.55 * l.alpha})`;
          ctx.fillText(l.name.toUpperCase(), l.x + 7, l.y - 6);
        }
      }

      // 4. the sun's path for the day
      if (this.sunPath) {
        ctx.save();
        ctx.setLineDash([2, 6]);
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = daylight > 0.5 ? 'rgba(255,255,255,0.45)' : 'rgba(255,214,150,0.35)';
        ctx.beginPath();
        let last = null;
        for (const pt of this.sunPath) {
          if (pt.alt < -2) { last = null; continue; }
          const p = this.project(pt.az, pt.alt);
          if (!last || Math.abs(p.x - last.x) > w / 2) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
          last = p;
        }
        ctx.stroke();
        ctx.restore();
      }

      // 5. clouds
      for (const c of this.clouds) {
        const cx = ((c.x + now * c.v) % 1.2 - 0.1) * w;
        const cy = c.y * hy;
        const sc = c.s * Math.min(w, 1400) * 0.035;
        const lit = mix(mix([40, 46, 70], [255, 168, 120], glowStrength), [255, 255, 255], daylight);
        const shade = mix([16, 20, 36], mix([170, 120, 140], [210, 222, 238], daylight), Math.max(daylight, glowStrength * 0.8));
        const opacity = 0.18 + 0.5 * Math.max(daylight, glowStrength) ;
        for (const pf of c.puffs) {
          const px = cx + pf.dx * sc, py = cy + pf.dy * sc, pr = pf.r * sc;
          const cg = ctx.createRadialGradient(px, py - pr * 0.3, 0, px, py, pr);
          cg.addColorStop(0, rgb(lit, opacity));
          cg.addColorStop(0.6, rgb(shade, opacity * 0.6));
          cg.addColorStop(1, rgb(shade, 0));
          ctx.fillStyle = cg;
          ctx.beginPath();
          ctx.arc(px, py, pr, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // 6. moon
      const mp = this.project(s.moon.azimuth, s.moon.altitude);
      if (s.moon.altitude > -3) {
        const r = Math.max(9, Math.min(w, 1400) * 0.011);
        const vis = 0.35 + 0.65 * (1 - daylight * 0.75);
        this.drawMoon(mp.x, mp.y, r, s.illum.phase, s.lat < 0, vis, daylight);
      }

      // 7. sun
      if (alt > -3) {
        const r = Math.max(10, Math.min(w, 1400) * 0.012);
        const low = 1 - smooth(-1, 14, alt);
        const core = mix([255, 252, 236], [255, 140, 70], low);
        const halo = ctx.createRadialGradient(sunP.x, sunP.y, 0, sunP.x, sunP.y, r * (7 + low * 6));
        halo.addColorStop(0, rgb(core, 0.85));
        halo.addColorStop(0.15, rgb(mix(core, [255, 200, 140], 0.5), 0.4));
        halo.addColorStop(1, rgb(core, 0));
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(sunP.x, sunP.y, r * (7 + low * 6), 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = rgb(core);
        ctx.beginPath();
        ctx.arc(sunP.x, sunP.y, r, 0, Math.PI * 2);
        ctx.fill();
      }

      // 8. hills (front layers are darker; far layers fade into haze)
      const nightLand = [[22, 26, 44], [14, 17, 30], [8, 10, 18]];
      const dayLand = [[120, 150, 160], [74, 110, 96], [44, 72, 58]];
      const dusk = [[120, 86, 110], [70, 52, 72], [36, 28, 42]];
      this.hills.forEach((hl, i) => {
        let c = mix(nightLand[i], dayLand[i], daylight);
        c = mix(c, dusk[i], glowStrength * 0.5 * (1 - daylight * 0.6));
        c = mix(c, col.horizon, [0.45, 0.2, 0.04][i] * (0.4 + daylight * 0.6));
        ctx.fillStyle = rgb(c);
        ctx.beginPath();
        ctx.moveTo(0, h);
        const n = hl.pts.length - 1;
        for (let k = 0; k <= n; k++) {
          ctx.lineTo((k / n) * w, hy - hl.lift + hl.pts[k] * hl.amp);
        }
        ctx.lineTo(w, h);
        ctx.closePath();
        ctx.fill();
      });

      // 9. ground fog + compass rose
      const fog = ctx.createLinearGradient(0, hy - 40, 0, h);
      fog.addColorStop(0, rgb(col.horizon, 0));
      fog.addColorStop(0.35, rgb(col.horizon, 0.12 + glowStrength * 0.1));
      fog.addColorStop(1, 'rgba(0,0,0,0.35)');
      ctx.fillStyle = fog;
      ctx.fillRect(0, hy - 40, w, h - hy + 40);

      const labels = [['N', 0], ['NE', 45], ['E', 90], ['SE', 135], ['S', 180], ['SW', 225], ['W', 270], ['NW', 315]];
      ctx.font = '500 11px "IBM Plex Mono", ui-monospace, monospace';
      ctx.textAlign = 'center';
      const by = h - 16;
      for (const [lab, az] of labels) {
        const p = this.project(az, 0);
        if (p.x < 14 || p.x > w - 14) continue;
        const major = lab.length === 1;
        ctx.fillStyle = `rgba(255,255,255,${major ? 0.75 : 0.4})`;
        ctx.fillText(lab, p.x, by);
        ctx.fillRect(p.x - 0.5, by - 22, 1, major ? 8 : 5);
      }
      for (let az = 0; az < 360; az += 15) {
        if (az % 45 === 0) continue;
        const p = this.project(az, 0);
        ctx.fillStyle = 'rgba(255,255,255,0.22)';
        ctx.fillRect(p.x - 0.5, by - 22, 1, 3);
      }

      return { sun: sunP, moon: mp };
    }

    drawMoon(x, y, r, phase, flip, vis, daylight) {
      const ctx = this.ctx;
      ctx.save();
      ctx.translate(x, y);
      if (flip) ctx.scale(-1, 1);
      // glow
      const glow = ctx.createRadialGradient(0, 0, r, 0, 0, r * 5);
      glow.addColorStop(0, `rgba(235,235,215,${0.22 * vis * (1 - daylight)})`);
      glow.addColorStop(1, 'rgba(235,235,215,0)');
      ctx.fillStyle = glow;
      ctx.beginPath(); ctx.arc(0, 0, r * 5, 0, Math.PI * 2); ctx.fill();
      // earthshine disc
      ctx.fillStyle = `rgba(90,96,120,${0.35 * vis * (1 - daylight)})`;
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
      // lit limb
      ctx.fillStyle = `rgba(246,243,226,${vis})`;
      litPath(ctx, r, phase);
      ctx.fill();
      ctx.restore();
    }
  }

  /** Build the illuminated portion of a moon disc of radius r for phase ∈ [0,1). */
  function litPath(ctx, r, phase) {
    const waxing = phase < 0.5;
    const rx = Math.abs(Math.cos(phase * Math.PI * 2)) * r;
    const crescent = phase < 0.25 || phase > 0.75;
    ctx.beginPath();
    if (waxing) {
      ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2, false);
      ctx.ellipse(0, 0, Math.max(rx, 0.01), r, 0, Math.PI / 2, -Math.PI / 2, crescent);
    } else {
      ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2, true);
      ctx.ellipse(0, 0, Math.max(rx, 0.01), r, 0, Math.PI / 2, -Math.PI / 2 + Math.PI * 2, !crescent);
    }
    ctx.closePath();
  }

  /** SVG path string for the lit part of the moon (centre 50,50, radius r). */
  function moonSvgPath(phase, r = 46) {
    const cx = 50, cy = 50;
    const waxing = phase < 0.5;
    const rx = (Math.abs(Math.cos(phase * Math.PI * 2)) * r).toFixed(2);
    const crescent = phase < 0.25 || phase > 0.75;
    const outerSweep = waxing ? 1 : 0;
    const termSweep = waxing ? (crescent ? 0 : 1) : (crescent ? 1 : 0);
    return `M ${cx} ${cy - r} A ${r} ${r} 0 0 ${outerSweep} ${cx} ${cy + r} A ${rx} ${r} 0 0 ${termSweep} ${cx} ${cy - r} Z`;
  }

  global.Sky = Sky;
  global.SkyUtil = { skyColors, moonSvgPath, rgb, mix };
})(window);
