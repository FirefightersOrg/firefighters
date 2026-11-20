// Generates the placeholder PWA icons in static/icons (white shield on the app's blue).
// Dependency-free: writes PNGs with node:zlib. Replace the output with real branding when available.
// Usage: node scripts/generate-pwa-icons.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const BLUE = [37, 99, 235];
const WHITE = [255, 255, 255];

function crc32(buf) {
	let crc = 0xffffffff;
	for (const byte of buf) {
		let c = (crc ^ byte) & 0xff;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		crc = (crc >>> 8) ^ c;
	}
	return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
	const len = Buffer.alloc(4);
	len.writeUInt32BE(data.length);
	const td = Buffer.concat([Buffer.from(type), data]);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(td));
	return Buffer.concat([len, td, crc]);
}

/** Shield shape centered on the canvas, scaled by `scale` (<1 keeps it inside a maskable safe zone). */
function inShield(x, y, size, scale) {
	const top = size * (0.5 - 0.3 * scale);
	const bottom = size * (0.5 + 0.32 * scale);
	const half = size * 0.26 * scale;
	if (y < top || y > bottom) return false;
	const t = (y - top) / (bottom - top);
	const w = t < 0.5 ? half : half * Math.sqrt(1 - ((t - 0.5) / 0.5) ** 2);
	return Math.abs(x - size / 2) <= w;
}

function png(size, scale) {
	const rows = [];
	for (let y = 0; y < size; y++) {
		const row = Buffer.alloc(1 + size * 3);
		for (let x = 0; x < size; x++) {
			row.set(inShield(x, y, size, scale) ? WHITE : BLUE, 1 + x * 3);
		}
		rows.push(row);
	}
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(size, 0);
	ihdr.writeUInt32BE(size, 4);
	ihdr.set([8, 2, 0, 0, 0], 8);
	return Buffer.concat([
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		chunk('IHDR', ihdr),
		chunk('IDAT', deflateSync(Buffer.concat(rows))),
		chunk('IEND', Buffer.alloc(0))
	]);
}

mkdirSync('static/icons', { recursive: true });
writeFileSync('static/icons/icon-192.png', png(192, 1));
writeFileSync('static/icons/icon-512.png', png(512, 1));
// Maskable: artwork stays inside the central safe zone.
writeFileSync('static/icons/icon-maskable-512.png', png(512, 0.8));
writeFileSync('static/icons/apple-touch-icon.png', png(180, 0.9));
