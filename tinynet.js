// Wortbaustein-Netz im Browser (Aufbau wie fastText), Gegenstück zu training/train_net.py.
// Zerlegt die Frage in Wörter, Wortpaare und Wortteile, mittelt deren gelernte Vektoren
// und wählt mit einer linearen Schicht das Thema. Läuft im Browser und in Node.

(function (root) {
  'use strict';

  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  const utf8 = new TextEncoder();

  function crc32(str) {
    let c = 0xffffffff;
    for (const b of utf8.encode(str)) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function fromBase64(b64) {
    if (typeof atob === 'function') {
      const s = atob(b64);
      const bytes = new Uint8Array(s.length);
      for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
      return bytes.buffer;
    }
    const buf = Buffer.from(b64, 'base64');
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  }

  class TinyNet {
    constructor(meta) {
      this.B = meta.buckets;
      this.D = meta.dim;
      this.ids = meta.ids;
      this.threshold = meta.threshold;
      this.nParams = meta.n_params;
      const scale = new Float32Array(fromBase64(meta.emb_scale));
      const q = new Int8Array(fromBase64(meta.emb));
      this.emb = new Float32Array(this.B * this.D);
      for (let r = 0; r < this.B; r++) {
        for (let c = 0; c < this.D; c++) this.emb[r * this.D + c] = q[r * this.D + c] * scale[r];
      }
      this.outW = new Float32Array(fromBase64(meta.out_w));
      this.outB = new Float32Array(fromBase64(meta.out_b));
    }

    static async load(url) {
      return new TinyNet(await fetch(url).then((r) => r.json()));
    }

    // Muss exakt features() in train_net.py entsprechen
    features(question) {
      const q = question.toLowerCase().trim().split(/\s+/).join(' ');
      const toks = q.match(/[a-z0-9äöüß'\-]+/g) || [];
      const f = toks.map((t) => 'w:' + t);
      for (let i = 0; i + 1 < toks.length; i++) f.push('b:' + toks[i] + '_' + toks[i + 1]);
      for (const raw of toks) {
        const t = '<' + raw + '>';
        const chars = Array.from(t);
        for (const n of [3, 4, 5]) {
          for (let i = 0; i + n <= chars.length; i++) f.push('c:' + chars.slice(i, i + n).join(''));
        }
      }
      const idx = f.map((x) => crc32(x) % this.B);
      return idx.length ? idx : [0];
    }

    // Gibt { id, confidence, probs } zurück
    classify(question) {
      const { D } = this;
      const idx = this.features(question);
      const h = new Float32Array(D);
      for (const r of idx) for (let c = 0; c < D; c++) h[c] += this.emb[r * D + c];
      for (let c = 0; c < D; c++) h[c] /= idx.length;
      const C = this.ids.length;
      const logits = new Float32Array(C);
      let max = -Infinity;
      for (let k = 0; k < C; k++) {
        let s = this.outB[k];
        for (let c = 0; c < D; c++) s += this.outW[k * D + c] * h[c];
        logits[k] = s;
        if (s > max) max = s;
      }
      let z = 0;
      for (let k = 0; k < C; k++) z += Math.exp(logits[k] - max);
      let best = 0;
      for (let k = 1; k < C; k++) if (logits[k] > logits[best]) best = k;
      return { id: this.ids[best], confidence: Math.exp(logits[best] - max) / z };
    }
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = TinyNet;
  else root.TinyNet = TinyNet;
})(typeof self !== 'undefined' ? self : this);
