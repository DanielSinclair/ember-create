const MAX_BYTES = 25 * 1024 * 1024;

export function decodeImageResponse(body: any) {
  const item = body?.data?.[0];
  const raw = item?.b64_json || (typeof item?.url === 'string' && item.url.startsWith('data:image/') ? item.url : undefined);
  if (typeof raw !== 'string') throw new Error('Muse Image returned no base64 image; remote response URLs are not downloaded.');
  const base64 = raw.replace(/^data:image\/[\w.+-]+;base64,/, '').replace(/\s/g, '');
  if (base64.length > Math.ceil(MAX_BYTES * 4 / 3) + 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw new Error('Muse Image returned invalid or oversized image data.');
  const bytes = Buffer.from(base64, 'base64');
  if (!bytes.length || bytes.length > MAX_BYTES) throw new Error('Muse Image returned an empty or oversized image.');
  let mimeType: string, extension: string, width: number | null = null, height: number | null = null;
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) {
    mimeType = 'image/png'; extension = 'png'; width = bytes.readUInt32BE(16); height = bytes.readUInt32BE(20);
  } else if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    mimeType = 'image/webp'; extension = 'webp';
    if (bytes.length >= 30 && bytes.toString('ascii', 12, 16) === 'VP8X') { width = bytes.readUIntLE(24, 3) + 1; height = bytes.readUIntLE(27, 3) + 1; }
  } else if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) {
    mimeType = 'image/jpeg'; extension = 'jpg';
    for (let offset = 2; offset + 8 < bytes.length;) {
      if (bytes[offset] !== 255) break;
      const marker = bytes[offset + 1];
      if (marker === 217 || marker === 218) break;
      const length = bytes.readUInt16BE(offset + 2);
      if (length < 2) break;
      if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)) { height = bytes.readUInt16BE(offset + 5); width = bytes.readUInt16BE(offset + 7); break; }
      offset += 2 + length;
    }
  } else throw new Error('Muse Image output is not a supported PNG, JPEG, or WebP file.');
  return { bytes, mimeType, extension, width, height };
}
