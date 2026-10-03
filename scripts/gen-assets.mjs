/**
 * Gera os assets estáticos do PWA (ícones PNG + som WAV) sem dependências:
 *   node scripts/gen-assets.mjs
 * Ícones: fundo indigo arredondado + relógio branco (versões any e maskable).
 * Som: 2 s de bipes 880 Hz com envelope, prontos para loop.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

// ---------------------------------------------------------------------------
// PNG encoder mínimo (RGBA, 8 bits)
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let crc = -1;
  for (let i = 0; i < buf.length; i += 1) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePNG(width, height, pixels) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filtro none
    Buffer.from(pixels.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([signature, pngChunk("IHDR", ihdr), pngChunk("IDAT", idat), pngChunk("IEND", Buffer.alloc(0))]);
}

// ---------------------------------------------------------------------------
// Ícone: relógio branco sobre fundo indigo (com anti-aliasing por supersample)
// ---------------------------------------------------------------------------

const INDIGO = [79, 70, 229];
const WHITE = [255, 255, 255];

function roundedRectSDF(x, y, cx, cy, hw, hh, r) {
  const qx = Math.abs(x - cx) - (hw - r);
  const qy = Math.abs(y - cy) - (hh - r);
  const ax = Math.max(qx, 0);
  const ay = Math.max(qy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - r;
}


function drawIcon(size, { maskable }) {
  const SS = 3;
  const pixels = new Uint8Array(size * size * 4);
  // maskable: fundo quadradinho full-bleed e conteúdo na safe zone (66%).
  const contentScale = maskable ? 0.66 : 1;
  const radius = maskable ? 0 : size * 0.22;

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let bgCov = 0;
      let fgCov = 0;
      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const x = px + (sx + 0.5) / SS;
          const y = py + (sy + 0.5) / SS;
          // fundo
          if (maskable) bgCov += 1;
          else if (roundedRectSDF(x, y, size / 2, size / 2, size / 2 - 0.5, size / 2 - 0.5, radius) <= 0) bgCov += 1;
          // conteúdo (relógio), centralizado e escalado
          const cx = size / 2;
          const cy = size / 2;
          const s = contentScale;
          const ringR = size * 0.30 * s;
          const ringT = size * 0.055 * s;
          const d = Math.hypot(x - cx, y - cy);
          const inRing = Math.abs(d - ringR) <= ringT / 2;
          const handW = size * 0.045 * s;
          const handLen = ringR * 0.62;
          const inHandV = Math.abs(x - cx) <= handW && y <= cy + handW && y >= cy - handLen;
          const inHandH = Math.abs(y - cy) <= handW && x >= cx - handW && x <= cx + handLen;
          const inCap = Math.hypot(x - cx, y - cy) <= handW; // pivô
          if (inRing || inHandV || inHandH || inCap) fgCov += 1;
        }
      }
      const total = SS * SS;
      const bg = bgCov / total;
      const fg = fgCov / total;
      const i = (py * size + px) * 4;
      // composição simples: fg (branco) sobre bg (indigo), alpha = max coverage
      const r = INDIGO[0] * (1 - fg) + WHITE[0] * fg;
      const g = INDIGO[1] * (1 - fg) + WHITE[1] * fg;
      const b = INDIGO[2] * (1 - fg) + WHITE[2] * fg;
      pixels[i] = Math.round(r);
      pixels[i + 1] = Math.round(g);
      pixels[i + 2] = Math.round(b);
      pixels[i + 3] = Math.round(255 * Math.max(bg, fg));
    }
  }
  return encodePNG(size, size, pixels);
}

// ---------------------------------------------------------------------------
// Som: WAV 16-bit mono 44.1 kHz, 2 s, 5 bipes com envelope
// ---------------------------------------------------------------------------

function alarmWav() {
  const rate = 44100;
  const duration = 2.0;
  const samples = Math.floor(rate * duration);
  const data = Buffer.alloc(samples * 2);
  const beep = 0.2;
  const gap = 0.1;
  const period = beep + gap;

  for (let i = 0; i < samples; i += 1) {
    const t = i / rate;
    const phase = t % period;
    let sample = 0;
    if (phase < beep) {
      const u = phase / beep; // 0..1 dentro do bipe
      const envelope = Math.min(1, u * 12) * Math.pow(1 - u, 1.4); // ataque rápido, decaimento
      const freq = 880;
      const wave = Math.sin(2 * Math.PI * freq * phase) + 0.35 * Math.sin(4 * Math.PI * freq * phase);
      sample = wave * envelope * 0.72;
    }
    const clamped = Math.max(-1, Math.min(1, sample));
    data.writeInt16LE(Math.round(clamped * 32767), i * 2);
  }

  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // PCM
  header.writeUInt16LE(1, 20); // formato
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

// ---------------------------------------------------------------------------

mkdirSync("public/icons", { recursive: true });
mkdirSync("public/sounds", { recursive: true });

for (const size of [180, 192, 512]) {
  writeFileSync(`public/icons/icon-${size}.png`, drawIcon(size, { maskable: false }));
}
for (const size of [192, 512]) {
  writeFileSync(`public/icons/icon-maskable-${size}.png`, drawIcon(size, { maskable: true }));
}
writeFileSync("public/sounds/alarm.wav", alarmWav());

console.log("assets gerados: public/icons/*.png + public/sounds/alarm.wav");
