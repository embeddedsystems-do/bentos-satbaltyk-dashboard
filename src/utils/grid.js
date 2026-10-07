// Cache promisow pobranych siatek, zeby przewijanie suwaka czasu / animacja
// nie odpytywaly serwera ponownie o juz zaladowane klatki.
const gridCache = new Map();

// Format .grid (patrz scripts/process_data.py): naglowek u16 szerokosc, u16
// wysokosc, f32 krok, potem strumien zlib z int16 zapisanych jako roznice
// wzgledem poprzedniej wartosci w wierszu. Trzymamy siatke jako Int16Array
// (polowa pamieci wzgledem float32, a wykres punktu ladowalby wszystkie klatki)
// i mnozymy przez krok dopiero przy odczycie.
const NODATA_Q = -32768;

async function decodeGrid(buffer) {
  const header = new DataView(buffer);
  const width = header.getUint16(0, true);
  const height = header.getUint16(2, true);
  const step = header.getFloat32(4, true);
  const stream = new Blob([new Uint8Array(buffer, 8)]).stream().pipeThrough(new DecompressionStream("deflate"));
  const q = new Int16Array(await new Response(stream).arrayBuffer());
  if (q.length !== width * height) throw new Error("uszkodzona siatka");
  // zapis do Int16Array zawija sie jak int16, tak samo jak roznice w skrypcie
  for (let row = 0; row < height; row += 1) {
    const start = row * width;
    for (let i = start + 1; i < start + width; i += 1) q[i] += q[i - 1];
  }
  return { q, width, height, step };
}

export function getGrid(url) {
  if (!gridCache.has(url)) {
    const promise = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
        return r.arrayBuffer();
      })
      .then(decodeGrid);
    // nieudane pobranie nie moze zostac w cache - kolejna proba ma szanse sie udac
    promise.catch(() => gridCache.delete(url));
    gridCache.set(url, promise);
  }
  return gridCache.get(url);
}

function cellValue(grid, index) {
  const q = grid.q[index];
  return q === NODATA_Q ? NaN : q * grid.step;
}

function mercatorY(lat) {
  const radians = (lat * Math.PI) / 180;
  return Math.log(Math.tan(Math.PI / 4 + radians / 2));
}

function gridCell(grid, bbox, lat, lon) { // grid: { width, height } - kazda siatka niesie wlasne wymiary
  const [lonMin, latMin, lonMax, latMax] = bbox;
  if (lon < lonMin || lon > lonMax || lat < latMin || lat > latMax) return null;

  const col = Math.floor(((lon - lonMin) / (lonMax - lonMin)) * grid.width);
  const north = mercatorY(latMax);
  const south = mercatorY(latMin);
  const row = Math.floor(((north - mercatorY(lat)) / (north - south)) * grid.height);
  return col < 0 || col >= grid.width || row < 0 || row >= grid.height ? null : { col, row };
}

// Odczytuje wartosc z siatki ulozonej tak samo jak ImageOverlay w Leaflet.
// Zwraca null poza zasiegiem albo dla NoData (lad / brak danych).
export function sampleGrid(grid, bbox, lat, lon) {
  const cell = gridCell(grid, bbox, lat, lon);
  if (!cell) return null;

  const value = cellValue(grid, cell.row * grid.width + cell.col);
  return Number.isNaN(value) ? null : value;
}

// Punkty przybrzezne (np. boja obok mola) moga po zaokragleniu trafic w
// komorke ladowa. Do ocen lokalnych bierzemy wtedy najblizsza poprawna
// komorke morska z niewielkiego sasiedztwa rastra.
export function sampleGridNearby(grid, bbox, lat, lon, maxRadius = 5) {
  const cell = gridCell(grid, bbox, lat, lon);
  if (!cell) return null;
  const centerCol = cell.col;
  const centerRow = cell.row;

  for (let radius = 0; radius <= maxRadius; radius += 1) {
    let nearest = null;
    let nearestDistance = Infinity;
    for (let rowOffset = -radius; rowOffset <= radius; rowOffset += 1) {
      for (let colOffset = -radius; colOffset <= radius; colOffset += 1) {
        if (radius > 0 && Math.max(Math.abs(rowOffset), Math.abs(colOffset)) !== radius) continue;
        const row = centerRow + rowOffset;
        const col = centerCol + colOffset;
        if (row < 0 || row >= grid.height || col < 0 || col >= grid.width) continue;
        const value = cellValue(grid, row * grid.width + col);
        if (!Number.isFinite(value)) continue;
        const distance = rowOffset * rowOffset + colOffset * colOffset;
        if (distance < nearestDistance) {
          nearest = value;
          nearestDistance = distance;
        }
      }
    }
    if (nearest != null) return nearest;
  }
  return null;
}

export function findNearestIndex(timestamps, targetIso) {
  if (!targetIso) return timestamps.length - 1;
  const target = new Date(targetIso).getTime();
  let bestIdx = 0;
  let bestDiff = Infinity;
  timestamps.forEach((entry, idx) => {
    const diff = Math.abs(new Date(entry.t).getTime() - target);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIdx = idx;
    }
  });
  return bestIdx;
}

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

export function degToCompass(deg) {
  const idx = Math.round(deg / 45) % 8;
  return COMPASS[idx];
}

// Formatuje odczyt wartosci dla danego produktu - wspolne dla celownika na
// mapie i listy przypietych punktow, zeby oba miejsca pokazywaly to samo.
export function formatProductValue(product, value) {
  if (value == null) return null;
  return product.circular
    ? `${value.toFixed(0)}° (${degToCompass(value)})`
    : `${value.toFixed(2)} ${product.unit}`;
}

export function formatTimestamp(iso, locale = "pl-PL") {
  const date = new Date(iso);
  return new Intl.DateTimeFormat(locale, {
    timeZone: "Europe/Warsaw",
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

// Krotszy format do etykiet na osi wykresu (bez dnia tygodnia).
export function formatTimestampShort(iso, locale = "pl-PL") {
  const date = new Date(iso);
  return new Intl.DateTimeFormat(locale, {
    timeZone: "Europe/Warsaw",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

// Pobiera (z cache) siatki dla wszystkich podanych znacznikow czasu i probkuje
// z nich kazdy z punktow - do wykresu punktow w czasie (jedna seria na punkt).
export async function loadPointsSeries(entries, bbox, points) {
  const grids = await Promise.all(entries.map((e) => getGrid(e.grid)));
  return points.map((p) =>
    entries.map((e, i) => ({ t: e.t, value: sampleGrid(grids[i], bbox, p.lat, p.lon) }))
  );
}
