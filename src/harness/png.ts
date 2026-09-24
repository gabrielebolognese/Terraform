/**
 * A minimal PNG encoder and decoder.
 *
 * Written rather than depended on, for one reason: the golden frames are
 * committed artefacts, and a dependency that re-encodes differently after an
 * upgrade would churn every one of them for no change in the picture. Node's
 * `zlib` does the only hard part.
 *
 * Deliberately narrow - 8-bit RGBA, no interlacing, no palettes, no ancillary
 * chunks. That is what the renderer produces and all it needs to read back.
 */

import { deflateSync, inflateSync } from "node:zlib";

const SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export interface Bitmap {
  readonly width: number;
  readonly height: number;
  /** RGBA, four bytes per pixel. */
  readonly pixels: Uint8ClampedArray;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    c = (CRC_TABLE[(c ^ (bytes[i] ?? 0)) & 0xff] ?? 0) ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const crcInput = Buffer.concat([head.subarray(4, 8), Buffer.from(data)]);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([head, Buffer.from(data), tail]);
}

export function encodePng(image: Bitmap): Buffer {
  const { width, height, pixels } = image;

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(6, 9); // colour type: RGBA
  ihdr.writeUInt8(0, 10); // compression
  ihdr.writeUInt8(0, 11); // filter
  ihdr.writeUInt8(0, 12); // interlace

  // Filter type 0 (none) on every scanline. Larger than an adaptive filter
  // would give, and exactly reproducible, which matters more here.
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    for (let x = 0; x < stride; x += 1) {
      raw[y * (stride + 1) + 1 + x] = pixels[y * stride + x] ?? 0;
    }
  }

  return Buffer.concat([
    Buffer.from(SIGNATURE),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", new Uint8Array(0)),
  ]);
}

export function decodePng(file: Uint8Array): Bitmap {
  for (let i = 0; i < SIGNATURE.length; i += 1) {
    if (file[i] !== SIGNATURE[i]) throw new Error("not a PNG");
  }

  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  let offset = SIGNATURE.length;
  let width = 0;
  let height = 0;
  const idat: Uint8Array[] = [];

  while (offset < file.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(
      file[offset + 4] ?? 0,
      file[offset + 5] ?? 0,
      file[offset + 6] ?? 0,
      file[offset + 7] ?? 0,
    );
    const body = file.subarray(offset + 8, offset + 8 + length);

    if (type === "IHDR") {
      width = view.getUint32(offset + 8);
      height = view.getUint32(offset + 12);
      const colourType = file[offset + 8 + 9];
      const bitDepth = file[offset + 8 + 8];
      if (bitDepth !== 8 || colourType !== 6) {
        throw new Error(`unsupported PNG: bit depth ${bitDepth}, colour type ${colourType}`);
      }
    } else if (type === "IDAT") {
      idat.push(body);
    } else if (type === "IEND") {
      break;
    }

    offset += 12 + length;
  }

  const raw = inflateSync(Buffer.concat(idat.map((b) => Buffer.from(b))));
  const stride = width * 4;
  const pixels = new Uint8ClampedArray(width * height * 4);

  // Un-filter. The encoder above only ever writes type 0, but a PNG written by
  // anything else may use the others, and rejecting those would make the
  // goldens un-editable by ordinary tools.
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)] ?? 0;
    for (let x = 0; x < stride; x += 1) {
      const value = raw[y * (stride + 1) + 1 + x] ?? 0;
      const left = x >= 4 ? (pixels[y * stride + x - 4] ?? 0) : 0;
      const up = y > 0 ? (pixels[(y - 1) * stride + x] ?? 0) : 0;
      const upLeft = x >= 4 && y > 0 ? (pixels[(y - 1) * stride + x - 4] ?? 0) : 0;

      let out: number;
      switch (filter) {
        case 0:
          out = value;
          break;
        case 1:
          out = value + left;
          break;
        case 2:
          out = value + up;
          break;
        case 3:
          out = value + Math.floor((left + up) / 2);
          break;
        case 4:
          out = value + paeth(left, up, upLeft);
          break;
        default:
          throw new Error(`unsupported PNG filter ${filter} on row ${y}`);
      }
      pixels[y * stride + x] = out & 0xff;
    }
  }

  return { width, height, pixels };
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}
