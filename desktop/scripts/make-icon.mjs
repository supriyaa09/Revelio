/**
 * Generates build/icon.png (512x512): the nav-green tile with the paper-color
 * sparkle from the sidebar. electron-builder converts this one PNG into
 * icon.ico (Windows) and icon.icns (macOS) at packaging time.
 *
 *   node scripts/make-icon.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas } from '@napi-rs/canvas';

const SIZE = 512;
const NAV = '#24352d';
const PAPER = '#f7f4ea';

const canvas = createCanvas(SIZE, SIZE);
const ctx = canvas.getContext('2d');

// Rounded tile (manual path — no reliance on roundRect support).
function roundedRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

roundedRect(0, 0, SIZE, SIZE, 112);
ctx.fillStyle = NAV;
ctx.fill();

// Four-point sparkle: concave curves between the cardinal points.
function sparkle(cx, cy, R) {
  const c = R * 0.18;
  ctx.beginPath();
  ctx.moveTo(cx, cy - R);
  ctx.quadraticCurveTo(cx + c, cy - c, cx + R, cy);
  ctx.quadraticCurveTo(cx + c, cy + c, cx, cy + R);
  ctx.quadraticCurveTo(cx - c, cy + c, cx - R, cy);
  ctx.quadraticCurveTo(cx - c, cy - c, cx, cy - R);
  ctx.closePath();
  ctx.fill();
}

ctx.fillStyle = PAPER;
sparkle(232, 288, 162); // main star
sparkle(382, 132, 56); // companion star

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'build');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'icon.png'), canvas.toBuffer('image/png'));
console.log('Wrote build/icon.png (512x512)');
