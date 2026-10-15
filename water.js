// Wasser-Animation für den Chat, gerechnet auf der Grafikkarte (WebGL, pro Pixel).
//
// Die Glasblase platzt, klares Wasser läuft von ihr aus über den Bildschirm: erst ein
// Schwall um die Blase, dann ein Wasserfilm, der mit gewellter Front und einigen
// Rinnsalen nach unten läuft. Das Wasser ist durchsichtig und wird durch Licht sichtbar:
// helle Lichtkante, dunklerer Rand (Meniskus), bewegtes Lichtspiel. Zum Schluss färbt
// es sich im Akzentblau ein. Alles hängt nur von der Zeit ab, 'out' läuft exakt rückwärts.
//
// waterFlood(canvas, { x, y }, 'in' | 'out', dauerMs) gibt ein Promise zurück.
// Ohne WebGL wird das Promise sofort erfüllt (der Chat blendet dann einfach ein).

(function (root) {
  'use strict';

  const VERT = `#version 300 es
  in vec2 a;
  void main() { gl_Position = vec4(a, 0.0, 1.0); }`;

  const FRAG = `#version 300 es
  precision highp float;
  uniform vec2 uRes;      // Größe in CSS-Pixeln
  uniform float uDpr;
  uniform float uP;       // Fortschritt 0..1
  uniform float uT;       // Zeit in Sekunden (läuft mit uP)
  uniform vec2 uO;        // Ursprung (Blase), y von oben
  uniform vec3 uBlue;
  uniform vec4 uF[8];     // Rinnsale: x, Breite, Vorlauf, Verzögerung
  out vec4 outColor;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  float smax(float a, float b, float k) {
    float h = clamp(0.5 + 0.5 * (a - b) / k, 0.0, 1.0);
    return mix(b, a, h) + k * h * (1.0 - h);
  }

  // Unterkante des Wasserfilms an Stelle x
  float front(float x) {
    float W = uRes.x, H = uRes.y;
    float reach = smoothstep(0.0, 0.4, uP) * (W + 240.0);
    float dist = abs(x - uO.x);
    if (dist > reach) return -1e5;
    float local = clamp((reach - dist) / 260.0, 0.0, 1.0);
    float base = -40.0 + smoothstep(0.08, 1.0, uP) * (H * 1.06 + 110.0);
    float y = uO.y * 0.5 + base * local;
    y += (22.0 * sin(x * 6.2832 / (W * 0.62) + uT * 2.6 + 1.3) + 9.0 * sin(x * 6.2832 / (W * 0.19) - uT * 3.7)) * local;
    for (int i = 0; i < 8; i++) {
      vec4 f = uF[i];
      float q = clamp((uP - f.w) / (1.0 - f.w), 0.0, 1.0);
      float d = (x - f.x) / f.y;
      y += f.z * q * q * exp(-d * d) * local;
    }
    return y;
  }

  void main() {
    vec2 pos = vec2(gl_FragCoord.x, uRes.y * uDpr - gl_FragCoord.y) / uDpr;

    // Abstand zur Wasserkante (positiv = im Wasser), Film und Schwall weich vereint
    float sdFilm = front(pos.x) - pos.y;
    vec2 rel = pos - uO;
    float th = atan(rel.y, rel.x);
    float diag = length(uRes);
    float R = 44.0 + (1.0 - pow(1.0 - min(1.0, uP * 2.4), 3.0)) * diag * 0.3;
    R *= 1.0 + 0.05 * sin(6.0 * th + uT * 5.0) + 0.035 * sin(11.0 * th - uT * 4.0);
    float sdSplash = R - length(rel);
    float sd = smax(sdFilm, sdSplash, 60.0);

    float edge = smoothstep(-0.9, 0.9, sd);           // scharfe, geglättete Kante
    if (edge <= 0.0) { outColor = vec4(0.0); return; }

    // Wasserdicke: an der Kante dünn, innen flach -> daraus Oberflächen-Normale
    float h = 1.0 - exp(-max(sd, 0.0) / 16.0);
    vec3 n = normalize(vec3(-dFdx(h) * 34.0, dFdy(h) * 34.0, 1.0));
    vec3 L = normalize(vec3(-0.45, 0.65, 0.62));
    float spec = pow(max(dot(reflect(-L, n), vec3(0.0, 0.0, 1.0)), 0.0), 36.0);
    float rim = exp(-max(sd, 0.0) / 3.5);              // dunklerer Meniskus direkt an der Kante
    float caust = noise(pos * 0.018 + vec2(uT * 0.25, -uT * 0.9)) * noise(pos * 0.041 - vec2(0.0, uT * 1.4));

    float dye = smoothstep(0.55, 1.0, uP);             // Einfärben zum Schluss
    float a = mix(0.10 + 0.22 * rim + 0.10 * caust, 1.0, dye);
    vec3 col = mix(uBlue * 0.9, uBlue, dye);
    col = mix(col, vec3(1.0), clamp(spec * 1.1 + caust * 0.25 * (1.0 - dye), 0.0, 1.0));
    a = clamp(a + spec * 0.85 * (1.0 - dye * 0.6), 0.0, 1.0) * edge;
    outColor = vec4(col * a, a);
  }`;

  function rng(seed) {
    return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  }

  function hexToRgb(str) {
    const m = str.match(/\d+(\.\d+)?/g) || [31, 79, 255];
    return m.slice(0, 3).map((v) => Number(v) / 255);
  }

  let cache = null; // WebGL-Programm einmal bauen

  function setup(canvas) {
    if (cache && cache.canvas === canvas) return cache;
    const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, antialias: false });
    if (!gl) return null;
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'a');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    const u = {};
    for (const name of ['uRes', 'uDpr', 'uP', 'uT', 'uO', 'uBlue', 'uF']) u[name] = gl.getUniformLocation(prog, name);
    cache = { canvas, gl, u };
    return cache;
  }

  function prepare(canvas, origin, seed) {
    const ctx = setup(canvas);
    if (!ctx) return null;
    const { gl, u } = ctx;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = window.innerWidth, H = window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    gl.viewport(0, 0, canvas.width, canvas.height);
    const rand = rng(seed);
    const fingers = [];
    for (let i = 0; i < 8; i++) {
      fingers.push(rand() * W, 10 + rand() * 18, (0.05 + rand() * 0.16) * H, 0.15 + rand() * 0.35);
    }
    gl.uniform2f(u.uRes, W, H);
    gl.uniform1f(u.uDpr, dpr);
    gl.uniform2f(u.uO, origin.x, origin.y);
    gl.uniform3fv(u.uBlue, hexToRgb(getComputedStyle(canvas).color));
    gl.uniform4fv(u.uF, new Float32Array(fingers));
    return ctx;
  }

  function drawAt(ctx, p, duration) {
    const { gl, u } = ctx;
    gl.uniform1f(u.uP, p);
    gl.uniform1f(u.uT, (p * duration) / 1000);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function waterFlood(canvas, origin, direction, duration, seed = 5) {
    return new Promise((resolve) => {
      let ctx;
      try {
        ctx = prepare(canvas, origin, seed);
      } catch (err) {
        console.warn('Wasser-Animation nicht verfügbar', err);
      }
      if (!ctx) return resolve();
      const start = performance.now();
      const frame = (now) => {
        const raw = Math.min(1, (now - start) / duration);
        drawAt(ctx, direction === 'in' ? raw : 1 - raw, duration);
        if (raw < 1) requestAnimationFrame(frame);
        else {
          if (direction === 'out') drawAt(ctx, 0, duration);
          resolve();
        }
      };
      requestAnimationFrame(frame);
    });
  }

  // Zum Testen: einen einzelnen Moment p (0..1) zeichnen
  function waterFrame(canvas, origin, p, duration = 1600, seed = 5) {
    const ctx = prepare(canvas, origin, seed);
    if (ctx) drawAt(ctx, p, duration);
    return !!ctx;
  }

  root.waterFlood = waterFlood;
  root.waterFrame = waterFrame;
})(self);
