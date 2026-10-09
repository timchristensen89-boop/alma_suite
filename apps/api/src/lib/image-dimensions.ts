/**
 * Pixel size of a PNG, JPEG or WebP from its header bytes — enough for the
 * website to size a listing photo without a decoder dependency. Returns null
 * when the header is not one we read; the image is still stored and served.
 */
export function imageDimensions(bytes: Buffer, mimeType: string): { width: number; height: number } | null {
  try {
    switch (mimeType) {
      case 'image/png':
        return png(bytes);
      case 'image/jpeg':
        return jpeg(bytes);
      case 'image/webp':
        return webp(bytes);
      default:
        return null;
    }
  } catch {
    return null;
  }
}

function png(bytes: Buffer) {
  // 8-byte signature, then the IHDR chunk: length(4) 'IHDR'(4) width(4) height(4).
  if (bytes.length < 24 || bytes.toString('ascii', 1, 4) !== 'PNG' || bytes.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function jpeg(bytes: Buffer) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1] ?? 0;
    // Standalone markers carry no length.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const length = bytes.readUInt16BE(offset + 2);
    // SOF0–SOF15 (except DHT 0xc4, JPG 0xc8, DAC 0xcc) hold height then width.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
    }
    offset += 2 + length;
  }
  return null;
}

function webp(bytes: Buffer) {
  if (bytes.length < 30 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP') return null;
  const chunk = bytes.toString('ascii', 12, 16);
  if (chunk === 'VP8X') {
    // 24-bit little-endian width-1 and height-1 at offsets 24 and 27.
    return { width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) };
  }
  if (chunk === 'VP8L') {
    const bits = bytes.readUInt32LE(21);
    return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
  }
  if (chunk === 'VP8 ') {
    // Lossy: frame header at 20, keyframe start code 9d 01 2a at 23, then 14-bit width and height.
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return null;
    return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
  }
  return null;
}
