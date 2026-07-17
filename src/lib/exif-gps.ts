/**
 * Minimal, dependency-free EXIF GPS reader for the browser.
 *
 * Reads only what we need to pin a photo on a map: GPSLatitude / GPSLongitude
 * (+ their N/S/E/W refs) from a JPEG's APP1/Exif block. Everything is wrapped so
 * any malformed / non-JPEG / un-geotagged file simply returns null — the photo
 * still uploads, it just gets no map pin. We read the ORIGINAL File because the
 * canvas resize we do before upload strips EXIF.
 */
export async function readGpsFromFile(file: File): Promise<{ lat: number; lng: number } | null> {
  try {
    if (!/jpe?g$/i.test(file.type) && !/\.jpe?g$/i.test(file.name)) return null;
    // The GPS IFD sits early in the file; 256 KB is plenty.
    const buf = await file.slice(0, 256 * 1024).arrayBuffer();
    return parseExifGps(new DataView(buf));
  } catch {
    return null;
  }
}

function parseExifGps(view: DataView): { lat: number; lng: number } | null {
  if (view.getUint16(0) !== 0xffff && view.getUint16(0) !== 0xffd8) {
    if (view.getUint16(0) !== 0xffd8) return null; // not a JPEG (SOI)
  }
  let offset = 2;
  const len = view.byteLength;
  // Walk the JPEG marker segments looking for APP1 (0xFFE1) with "Exif".
  while (offset + 4 < len) {
    if (view.getUint8(offset) !== 0xff) break;
    const marker = view.getUint8(offset + 1);
    const size = view.getUint16(offset + 2);
    if (marker === 0xe1) {
      const exifStart = offset + 4;
      // "Exif\0\0"
      if (view.getUint32(exifStart) === 0x45786966 && view.getUint16(exifStart + 4) === 0x0000) {
        return readTiffGps(view, exifStart + 6);
      }
    }
    if (marker === 0xda) break; // start of scan — image data begins
    offset += 2 + size;
  }
  return null;
}

function readTiffGps(view: DataView, tiff: number): { lat: number; lng: number } | null {
  const byteOrder = view.getUint16(tiff);
  const le = byteOrder === 0x4949; // 'II' little-endian, 'MM' big-endian
  const u16 = (o: number) => view.getUint16(o, le);
  const u32 = (o: number) => view.getUint32(o, le);

  const ifd0 = tiff + u32(tiff + 4);
  // Find the GPS IFD pointer (tag 0x8825) in IFD0.
  const count0 = u16(ifd0);
  let gpsIfd = 0;
  for (let i = 0; i < count0; i++) {
    const entry = ifd0 + 2 + i * 12;
    if (u16(entry) === 0x8825) { gpsIfd = tiff + u32(entry + 8); break; }
  }
  if (!gpsIfd) return null;

  // Read the GPS IFD entries we care about.
  const count = u16(gpsIfd);
  let latRef = 'N', lngRef = 'E';
  let lat: number | null = null, lng: number | null = null;
  for (let i = 0; i < count; i++) {
    const entry = gpsIfd + 2 + i * 12;
    const tag = u16(entry);
    const valOff = entry + 8;
    if (tag === 0x0001) latRef = String.fromCharCode(view.getUint8(valOff));
    else if (tag === 0x0003) lngRef = String.fromCharCode(view.getUint8(valOff));
    else if (tag === 0x0002) lat = readRationalDMS(view, tiff + u32(valOff), le);
    else if (tag === 0x0004) lng = readRationalDMS(view, tiff + u32(valOff), le);
  }
  if (lat == null || lng == null) return null;
  const latSigned = latRef === 'S' ? -lat : lat;
  const lngSigned = lngRef === 'W' ? -lng : lng;
  if (!Number.isFinite(latSigned) || !Number.isFinite(lngSigned)) return null;
  if (Math.abs(latSigned) > 90 || Math.abs(lngSigned) > 180) return null;
  return { lat: latSigned, lng: lngSigned };
}

/** Three RATIONALs (deg, min, sec) → decimal degrees. */
function readRationalDMS(view: DataView, o: number, le: boolean): number {
  const rat = (p: number) => view.getUint32(p, le) / (view.getUint32(p + 4, le) || 1);
  const deg = rat(o), min = rat(o + 8), sec = rat(o + 16);
  return deg + min / 60 + sec / 3600;
}
