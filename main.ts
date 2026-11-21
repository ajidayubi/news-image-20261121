import * as fs from 'node:fs';
import * as zlib from 'node:zlib';
import * as path from 'node:path';

const W = 1024;
const H = 1024;
const pixels = new Uint8Array(W * H * 3);

function setPixel(x: number, y: number, r: number, g: number, b: number) {
  if (x < 0 || x >= W || y < 0 || y >= H) return;
  const idx = (y * W + x) * 3;
  pixels[idx] = r;
  pixels[idx + 1] = g;
  pixels[idx + 2] = b;
}

function fillRect(x: number, y: number, w: number, h: number, color: [number, number, number]) {
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(W, Math.floor(x + w));
  const y1 = Math.min(H, Math.floor(y + h));
  const [r, g, b] = color;
  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) {
      const idx = (py * W + px) * 3;
      pixels[idx] = r;
      pixels[idx + 1] = g;
      pixels[idx + 2] = b;
    }
  }
}

function hline(x: number, y: number, w: number, color: [number, number, number], thickness: number = 1) {
  fillRect(x, y, w, thickness, color);
}

function vline(x: number, y: number, h: number, color: [number, number, number], thickness: number = 1) {
  fillRect(x, y, thickness, h, color);
}

function frame(x: number, y: number, w: number, h: number, color: [number, number, number], thickness: number = 1) {
  hline(x, y, w, color, thickness);
  hline(x, y + h - thickness, w, color, thickness);
  vline(x, y, h, color, thickness);
  vline(x + w - thickness, y, h, color, thickness);
}

function fillCircle(cx: number, cy: number, r: number, color: [number, number, number]) {
  const x0 = Math.max(0, Math.floor(cx - r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const x1 = Math.min(W, Math.floor(cx + r + 1));
  const y1 = Math.min(H, Math.floor(cy + r + 1));
  const [cr, cg, cb] = color;
  const r2 = r * r;
  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) {
      const dx = px - cx;
      const dy = py - cy;
      if (dx * dx + dy * dy <= r2) {
        const idx = (py * W + px) * 3;
        pixels[idx] = cr;
        pixels[idx + 1] = cg;
        pixels[idx + 2] = cb;
      }
    }
  }
}

const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) {
    c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  }
  crcTable[i] = c;
}

function computeCrc(buf: Buffer): number {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  }
  return c ^ 0xFFFFFFFF;
}

function writeChunk(type: string, data: Buffer): Buffer {
  const len = data.length;
  const chunk = Buffer.alloc(12 + len);
  chunk.writeUInt32BE(len, 0);
  chunk.write(type, 4, 'ascii');
  data.copy(chunk, 8);
  const typeAndData = Buffer.alloc(4 + len);
  chunk.copy(typeAndData, 0, 4, 8 + len);
  const crc = computeCrc(typeAndData);
  chunk.writeInt32BE(crc, 8 + len);
  return chunk;
}

function encodePNG(): Buffer {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(W, 0);
  ihdrData.writeUInt32BE(H, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 2; // color type truecolor RGB
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace
  const ihdrChunk = writeChunk('IHDR', ihdrData);

  const rowSize = W * 3;
  const filtered = Buffer.alloc(H * (rowSize + 1));
  for (let y = 0; y < H; y++) {
    filtered[y * (rowSize + 1)] = 0; // filter byte 0
    filtered.set(pixels.subarray(y * rowSize, (y + 1) * rowSize), y * (rowSize + 1) + 1);
  }

  const compressed = zlib.deflateSync(filtered, { level: 9 });
  const idatChunk = writeChunk('IDAT', compressed);
  const iendChunk = writeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([sig, ihdrChunk, idatChunk, iendChunk]);
}

const FONT: Record<string, number[]> = {
  'A': [0x0e, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  'B': [0x1e, 0x11, 0x11, 0x1e, 0x11, 0x11, 0x1e],
  'C': [0x0e, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0e],
  'D': [0x1e, 0x12, 0x11, 0x11, 0x11, 0x12, 0x1e],
  'E': [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x1f],
  'F': [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x10],
  'G': [0x0e, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0e],
  'H': [0x11, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  'I': [0x0e, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0e],
  'J': [0x07, 0x02, 0x02, 0x02, 0x02, 0x12, 0x0c],
  'K': [0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11],
  'L': [0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1f],
  'M': [0x11, 0x1b, 0x15, 0x15, 0x11, 0x11, 0x11],
  'N': [0x11, 0x19, 0x15, 0x13, 0x11, 0x11, 0x11],
  'O': [0x0e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  'P': [0x1e, 0x11, 0x11, 0x1e, 0x10, 0x10, 0x10],
  'Q': [0x0e, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0d],
  'R': [0x1e, 0x11, 0x11, 0x1e, 0x14, 0x12, 0x11],
  'S': [0x0e, 0x10, 0x10, 0x0e, 0x01, 0x01, 0x0e],
  'T': [0x1f, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
  'U': [0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  'V': [0x11, 0x11, 0x11, 0x11, 0x11, 0x0a, 0x04],
  'W': [0x11, 0x11, 0x11, 0x15, 0x15, 0x1b, 0x11],
  'X': [0x11, 0x11, 0x0a, 0x04, 0x0a, 0x11, 0x11],
  'Y': [0x11, 0x11, 0x0a, 0x04, 0x04, 0x04, 0x04],
  'Z': [0x1f, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1f],
  '0': [0x0e, 0x13, 0x15, 0x15, 0x15, 0x19, 0x0e],
  '1': [0x04, 0x0c, 0x04, 0x04, 0x04, 0x04, 0x0e],
  '2': [0x0e, 0x11, 0x01, 0x06, 0x08, 0x10, 0x1f],
  '3': [0x1f, 0x01, 0x02, 0x06, 0x01, 0x11, 0x0e],
  '4': [0x02, 0x06, 0x0a, 0x12, 0x1f, 0x02, 0x02],
  '5': [0x1f, 0x10, 0x1e, 0x01, 0x01, 0x11, 0x0e],
  '6': [0x0e, 0x10, 0x10, 0x1e, 0x11, 0x11, 0x0e],
  '7': [0x1f, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08],
  '8': [0x0e, 0x11, 0x11, 0x0e, 0x11, 0x11, 0x0e],
  '9': [0x0e, 0x11, 0x11, 0x0f, 0x01, 0x01, 0x0e],
  ' ': [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
  ',': [0x00, 0x00, 0x00, 0x00, 0x00, 0x04, 0x08],
  '.': [0x00, 0x00, 0x00, 0x00, 0x00, 0x04, 0x04],
  ':': [0x00, 0x00, 0x04, 0x00, 0x00, 0x04, 0x00],
  '\'': [0x04, 0x04, 0x02, 0x00, 0x00, 0x00, 0x00],
  '-': [0x00, 0x00, 0x00, 0x1f, 0x00, 0x00, 0x00],
  '&': [0x0c, 0x12, 0x14, 0x08, 0x15, 0x12, 0x0d],
  '!': [0x04, 0x04, 0x04, 0x04, 0x04, 0x00, 0x04],
  '?': [0x0e, 0x11, 0x01, 0x02, 0x04, 0x00, 0x04],
  '/': [0x01, 0x02, 0x02, 0x04, 0x08, 0x08, 0x10],
  '(': [0x02, 0x04, 0x08, 0x08, 0x08, 0x04, 0x02],
  ')': [0x08, 0x04, 0x02, 0x02, 0x02, 0x04, 0x08],
  '%': [0x18, 0x19, 0x02, 0x04, 0x08, 0x13, 0x03],
  '$': [0x04, 0x0e, 0x15, 0x0e, 0x15, 0x0e, 0x04],
  '"': [0x0a, 0x0a, 0x00, 0x00, 0x00, 0x00, 0x00],
  '—': [0x00, 0x00, 0x00, 0x1f, 0x1f, 0x00, 0x00],
  '•': [0x00, 0x04, 0x0e, 0x0e, 0x0e, 0x04, 0x00],
  '–': [0x00, 0x00, 0x00, 0x1f, 0x00, 0x00, 0x00],
  ';': [0x00, 0x04, 0x00, 0x00, 0x04, 0x04, 0x08]
};

function drawChar(x: number, y: number, ch: string, scale: number, color: [number, number, number]) {
  const glyph = FONT[ch] || FONT['?'] || [0,0,0,0,0,0,0];
  const [r, g, b] = color;
  for (let row = 0; row < 7; row++) {
    const bits = glyph[row];
    for (let col = 0; col < 5; col++) {
      if ((bits & (1 << (4 - col))) !== 0) {
        fillRect(x + col * scale, y + row * scale, scale, scale, color);
      }
    }
  }
}

function drawText(startX: number, startY: number, text: string, scale: number, color: [number, number, number], maxWidth: number): number {
  const upper = text.toUpperCase();
  const words = upper.split(' ');
  let curX = startX;
  let curY = startY;
  const charW = 6 * scale;
  const lineHeight = 9 * scale;

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const wordW = word.length * charW;
    if (curX + wordW > startX + maxWidth && curX > startX) {
      curX = startX;
      curY += lineHeight;
    }
    for (let c = 0; c < word.length; c++) {
      drawChar(curX, curY, word[c], scale, color);
      curX += charW;
    }
    if (i < words.length - 1) {
      if (curX + charW <= startX + maxWidth) {
        drawChar(curX, curY, ' ', scale, color);
        curX += charW;
      } else {
        curX = startX;
        curY += lineHeight;
      }
    }
  }
  return curY + lineHeight - startY;
}

function drawNewspaper() {
  // Canvas background: warm paper off-white (247, 243, 232)
  fillRect(0, 0, W, H, [247, 243, 232]);

  // Top: 4-pixel black rule across full width at y=8
  hline(0, 8, W, [0, 0, 0], 4);

  // Masthead "THE WORLD TODAY" centered, very large (scale 9), black around y=24
  // 15 chars * 6 * 9 = 810 width. Centered at (1024 - 810) / 2 = 107
  drawText(107, 24, "THE WORLD TODAY", 9, [0, 0, 0], 1000);

  // 3-pixel red rule (178, 34, 34) under masthead at y=96
  hline(0, 96, W, [178, 34, 34], 3);

  // Dateline line, small (scale 2): left "SATURDAY, 21 NOVEMBER 2026", right "ONE IMAGE, ONE DAY"
  drawText(40, 103, "SATURDAY, 21 NOVEMBER 2026", 2, [50, 50, 50], 600);
  drawText(750, 103, "ONE IMAGE, ONE DAY", 2, [50, 50, 50], 300);

  // 2-pixel black rule at y=122
  hline(0, 122, W, [0, 0, 0], 2);

  // Lead story (upper half, y~135..520)
  // Big headline in 3 lines, scale 6, black, left-starting x=40, reading "RUSSIA RAINS FIRE ON KYIV — MISSILES LAND IN POLAND"
  drawText(40, 135, "RUSSIA RAINS FIRE ON KYIV — MISSILES LAND IN POLAND", 6, [0, 0, 0], 944);

  // Under headline, one line of standfirst (scale 2): "Moscow's biggest strikes of the year hit bridges and railways as allies drill nearby; Tusk calls it a provocation."
  drawText(40, 260, "MOSCOW'S BIGGEST STRIKES OF THE YEAR HIT BRIDGES AND RAILWAYS AS ALLIES DRILL NEARBY; TUSK CALLS IT A PROVOCATION.", 2, [30, 30, 30], 944);

  // Large photo panel (x=40, w=944, h=190, y=300): night-sky scene drawn by code
  fillRect(40, 300, 944, 190, [15, 20, 35]); // dark blue-black sky
  // City skyline silhouette at bottom of panel (y=440..490)
  fillRect(60, 430, 45, 60, [8, 10, 20]);
  fillRect(115, 400, 35, 90, [8, 10, 20]);
  fillRect(160, 450, 60, 40, [8, 10, 20]);
  fillRect(230, 380, 50, 110, [8, 10, 20]);
  fillRect(290, 420, 40, 70, [8, 10, 20]);
  fillRect(340, 360, 55, 130, [8, 10, 20]);
  fillRect(405, 440, 45, 50, [8, 10, 20]);
  fillRect(460, 390, 70, 100, [8, 10, 20]);
  fillRect(540, 420, 50, 70, [8, 10, 20]);
  fillRect(600, 370, 65, 120, [8, 10, 20]);
  fillRect(680, 430, 40, 60, [8, 10, 20]);
  fillRect(730, 400, 55, 90, [8, 10, 20]);
  fillRect(800, 440, 70, 50, [8, 10, 20]);
  fillRect(880, 410, 70, 80, [8, 10, 20]);

  // Orange explosion bursts with smoke columns
  fillCircle(140, 380, 22, [230, 120, 30]);
  fillCircle(140, 370, 12, [255, 220, 100]);
  fillCircle(360, 340, 28, [240, 90, 20]);
  fillCircle(360, 330, 15, [255, 200, 80]);
  fillCircle(620, 350, 25, [220, 100, 30]);
  fillCircle(620, 340, 14, [255, 210, 90]);
  fillCircle(750, 380, 20, [235, 110, 35]);
  fillCircle(750, 370, 10, [255, 220, 90]);

  // Red alert stripe along the bottom of photo panel
  fillRect(40, 484, 944, 6, [178, 34, 34]);

  // Thin caption line (scale 1) under photo panel at y=498
  drawText(40, 498, "KYIV UNDER FIRE OVERNIGHT: MORE THAN 400 DRONES AND 110 MISSILES, AND TWO FALL IN POLAND.", 1, [70, 70, 70], 944);

  // Thin divider rule at y=515
  hline(40, 515, 944, [150, 150, 150], 1);

  // Middle band (y ~ 530 .. 815): two columns with a vertical divider
  // Left column: x=40, w=452. Right column: x=532, w=452. Vertical divider at x=512, y=530..815
  vline(512, 530, 285, [180, 180, 180], 1);

  // Revision: stack story blocks by measured text height so wrapped headlines never overlap bodies.
  // --- Left Column ---
  let lcY = 530;
  // Story A
  lcY += drawText(40, lcY, "AI ROUT: S&P IN CORRECTION, NASDAQ ERASES 2026 GAINS", 3, [0, 0, 0], 452) + 6;
  lcY += drawText(40, lcY, "US stocks fall 3.7% as doubts over AI spending trigger tech's worst week since Covid; Anthropic slides on day two.", 1, [40, 40, 40], 452) + 10;

  // Story B
  lcY += drawText(40, lcY, "TRUMP CALLS PUTIN 'MY FRIEND' AFTER SHENZHEN", 3, [0, 0, 0], 452) + 6;
  lcY += drawText(40, lcY, "The president defends his closeness to Putin and Xi; Zelensky answers: Putin is a 'killer'.", 1, [40, 40, 40], 452) + 10;

  // Story C
  lcY += drawText(40, lcY, "WORLD COURT: MYANMAR GUILTY OF GENOCIDE", 3, [0, 0, 0], 452) + 6;
  drawText(40, lcY, "The Hague rules 9–6 that Myanmar committed genocide against the Rohingya in Rakhine.", 1, [40, 40, 40], 452);

  // --- Right Column ---
  let rcY = 530;
  // Small stock-chart panel (frame, axes, red line falling steeply left to right with three ticks)
  const chartX = 532;
  const chartY = rcY;
  const chartW = 452;
  const chartH = 95;
  frame(chartX, chartY, chartW, chartH, [100, 100, 100], 1);
  // Chart background
  fillRect(chartX + 1, chartY + 1, chartW - 2, chartH - 2, [252, 250, 245]);
  // Axis grid ticks
  hline(chartX + 20, chartY + 20, chartW - 40, [220, 220, 220], 1);
  hline(chartX + 20, chartY + 50, chartW - 40, [220, 220, 220], 1);
  hline(chartX + 20, chartY + 80, chartW - 40, [220, 220, 220], 1);
  // Red downward stock line (falling steeply)
  // We can draw line segments or small dots
  for (let px = 0; px < 400; px++) {
    // curve from top-left to bottom-right
    const py = chartY + 15 + Math.floor(px * 0.15) + Math.sin(px * 0.05) * 8;
    if (py > chartY + 5 && py < chartY + chartH - 5) {
      fillRect(chartX + 25 + px, py, 2, 2, [178, 34, 34]);
    }
  }
  rcY += chartH + 6;

  // Caption for stock chart
  rcY += drawText(chartX, rcY, "NASDAQ -5.3%, NIKKEI -5.1%", 2, [178, 34, 34], chartW) + 6;

  // Story A (Right)
  rcY += drawText(chartX, rcY, "UK AND EU SIGN BIGGEST POST-BREXIT DEALS", 3, [0, 0, 0], chartW) + 6;
  rcY += drawText(chartX, rcY, "Burnham seals food, carbon and youth mobility pacts in Brussels; 100,000 young Britons gain EU access.", 1, [40, 40, 40], chartW) + 10;

  // Story B (Right)
  rcY += drawText(chartX, rcY, "HOUTHI MISSILES AT RIYADH SHOT DOWN", 3, [0, 0, 0], chartW) + 6;
  drawText(chartX, rcY, "Saudi-led coalition intercepts three ballistic missiles, the third night of alerts.", 1, [40, 40, 40], chartW);

  // Divider line before ticker at y=825
  hline(0, 825, W, [0, 0, 0], 2);

  // Bottom ticker (y ~ 830..890): solid black band across full width with white text (scale 2)
  fillRect(0, 830, W, 76, [0, 0, 0]);
  const tickerText = "COP31 DEADLOCKED OVER FOSSIL FUELS • PERU QUAKE 6.9 SHAKES ANDES • BAYER PAYS $7.25BN OVER ROUNDUP • CANCER PILL MAKES TUMOURS VANISH IN 1 IN 12 • FBI AND USDA HACKED • NVIDIA FACES SEC ACCOUNTING PROBE • BITCOIN SLIDES TOWARD $62K • GEN Z PROTESTS SPREAD IN 25 COUNTRIES";
  drawText(15, 834, tickerText, 2, [255, 255, 255], 1000);

  // Divider line before footer at y=900
  hline(0, 900, W, [0, 0, 0], 1);

  // Footer (y ~ 920): centered small line (scale 1), grey: "THE WORLD TODAY — SATURDAY 21 NOVEMBER 2026 — DRAWN ENTIRELY BY CODE"
  // 73 chars * 6 = 438 width at scale 1. Centered at (1024 - 438)/2 = 293
  drawText(293, 920, "THE WORLD TODAY — SATURDAY 21 NOVEMBER 2026 — DRAWN ENTIRELY BY CODE", 1, [100, 100, 100], 600);
}

function main() {
  try {
    drawNewspaper();
    const pngBuf = encodePNG();
    const outDir = process.env.MAKEFUN_OUTPUT_DIR || '/output';
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }
    const outPath = path.join(outDir, 'entry.png');
    fs.writeFileSync(outPath, pngBuf);
    process.exit(0);
  } catch (err) {
    console.error('Failed to generate entry.png:', err);
    process.exit(1);
  }
}

main();
