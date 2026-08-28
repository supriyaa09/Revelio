/**
 * One-off generator for build/icon.ico.
 *
 * electron-builder normally converts build/icon.png to .ico itself, but its
 * WASM icon tool fails on this machine with "WebAssembly.Memory(): could not
 * allocate memory". Providing a prebuilt icon.ico makes electron-builder skip
 * the conversion entirely.
 *
 * The ICO embeds PNG-compressed entries (valid since Windows Vista), resized
 * from build/icon.png with @napi-rs/canvas (already an app dependency).
 *
 * Usage: node --experimental-strip-types scripts/make-ico.mts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';

const root = join(import.meta.dirname, '..');
const iconPath = join(root, 'build', 'icon.png');

// Sanity-check the PNG signature before handing it to canvas.
const sig = readFileSync(iconPath).subarray(0, 8).toString('hex');
if (sig !== '89504e470d0a1a0a') throw new Error('build/icon.png is not a PNG');

const image = await loadImage(iconPath);

const sizes = [256, 48, 32, 16];
const pngs = sizes.map((size) => {
  const canvas = createCanvas(size, size);
  canvas.getContext('2d').drawImage(image, 0, 0, size, size);
  return canvas.toBuffer('image/png');
});

// ICO container: ICONDIR header + one ICONDIRENTRY per size + image data.
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(pngs.length, 4);

let offset = 6 + 16 * pngs.length;
const entries = pngs.map((png, i) => {
  const size = sizes[i]!;
  const entry = Buffer.alloc(16);
  entry.writeUInt8(size >= 256 ? 0 : size, 0); // width (0 means 256)
  entry.writeUInt8(size >= 256 ? 0 : size, 1); // height (0 means 256)
  entry.writeUInt8(0, 2); // no palette
  entry.writeUInt8(0, 3); // reserved
  entry.writeUInt16LE(1, 4); // color planes
  entry.writeUInt16LE(32, 6); // bits per pixel
  entry.writeUInt32LE(png.length, 8); // image data size
  entry.writeUInt32LE(offset, 12); // image data offset
  offset += png.length;
  return entry;
});

writeFileSync(join(root, 'build', 'icon.ico'), Buffer.concat([header, ...entries, ...pngs]));
console.log(`wrote build/icon.ico (${sizes.join(', ')} px, ${offset} bytes)`);
