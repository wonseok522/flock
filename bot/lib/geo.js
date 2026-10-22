// Parses a PostGIS point as PostgREST returns it. Depending on the PostgREST /
// PostGIS versions a geography column arrives as EWKB hex ("0101000020E6..."),
// GeoJSON ({type:'Point', coordinates:[lng, lat]}) or WKT ("SRID=4326;POINT(lng lat)").
// Returns {lat, lng} or null.

const valid = (lat, lng) =>
  Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

function fromEwkbHex(hex) {
  const buf = Buffer.from(hex, 'hex');
  if (buf.length < 21) return null;
  const le = buf[0] === 1;
  const u32 = (o) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
  const f64 = (o) => (le ? buf.readDoubleLE(o) : buf.readDoubleBE(o));
  const type = u32(1);
  let off = 5;
  if (type & 0x20000000) off += 4; // EWKB SRID flag
  if ((type & 0xffff) % 1000 !== 1) return null; // not a POINT (1, 1001, 2001, 3001)
  if (buf.length < off + 16) return null;
  const lng = f64(off);
  const lat = f64(off + 8);
  return valid(lat, lng) ? { lat, lng } : null;
}

export function parsePoint(value) {
  if (!value) return null;
  let v = value;
  if (typeof v === 'string') {
    const s = v.trim();
    if (s.startsWith('{')) {
      try { v = JSON.parse(s); } catch { return null; }
    } else {
      const wkt = s.match(/POINT\s*Z?M?\s*\(\s*([-+\d.eE]+)\s+([-+\d.eE]+)/i);
      if (wkt) {
        const lng = Number(wkt[1]);
        const lat = Number(wkt[2]);
        return valid(lat, lng) ? { lat, lng } : null;
      }
      if (/^[0-9a-fA-F]+$/.test(s) && s.length % 2 === 0) return fromEwkbHex(s);
      return null;
    }
  }
  if (typeof v === 'object' && v?.type === 'Point' && Array.isArray(v.coordinates)) {
    const [lng, lat] = v.coordinates.map(Number);
    return valid(lat, lng) ? { lat, lng } : null;
  }
  return null;
}

export function osmLink({ lat, lng }) {
  const la = lat.toFixed(5);
  const lo = lng.toFixed(5);
  return `https://www.openstreetmap.org/?mlat=${la}&mlon=${lo}#map=18/${la}/${lo}`;
}
