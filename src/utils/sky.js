// Pora dnia dla tafli wody w panelu bocznym (SidebarWater): z pozycji slonca
// nad Trojmiastem liczymy wysokosc i azymut, a z wysokosci plynnie
// interpolowana paleta (noc -> zmierzch/switanie -> zlota godzina -> dzien).
// Dzieki wysokosci slonca (a nie stalym godzinom) wschod i zachod wypadaja
// we wlasciwym momencie o kazdej porze roku.

const RAD = Math.PI / 180;

export const SKY_LAT = 54.45; // Trojmiasto
export const SKY_LON = 18.6;

// Niskoprecyzyjny algorytm pozycji slonca (Astronomical Almanac), dokladnosc
// rzedu 0.1 stopnia - w zupelnosci na potrzeby tla. Azymut od polnocy, zgodnie
// z ruchem wskazowek (wschod = 90).
export function sunPosition(timeMs, lat = SKY_LAT, lon = SKY_LON) {
  const d = timeMs / 86400000 + 2440587.5 - 2451545.0; // dni od J2000
  const g = (357.529 + 0.98560028 * d) * RAD;
  const q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
  const e = (23.439 - 0.00000036 * d) * RAD;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const H = (280.46061837 + 360.98564736629 * d + lon) * RAD - ra;
  const phi = lat * RAD;
  const altitude = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  const azimuth = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi)) + Math.PI;
  return { altitude: altitude / RAD, azimuth: azimuth / RAD };
}

// Kolory jako [r, g, b, a]. "day" odpowiada dawnemu, stalemu wygladowi panelu.
const STOPS = [
  {
    alt: -14, // noc
    tintTop: [0, 8, 40, 0.72],
    tintMid: [0, 6, 32, 0.82],
    tintBottom: [0, 9, 50, 0.95],
    brightness: 0.32,
    saturate: 0.7,
    ray: [150, 190, 255, 0.12],
    particle: [120, 255, 215, 1.3], // a = mnoznik przezroczystosci (lekka bioluminescencja)
    sun: [255, 250, 230, 0],
    moon: 1,
  },
  {
    alt: -6, // zmierzch / switanie
    tintTop: [48, 40, 130, 0.55],
    tintMid: [25, 25, 100, 0.68],
    tintBottom: [0, 14, 70, 0.94],
    brightness: 0.55,
    saturate: 0.95,
    ray: [160, 150, 255, 0.25],
    particle: [190, 200, 255, 1.1],
    sun: [255, 170, 90, 0],
    moon: 0.5,
  },
  {
    alt: 0, // slonce na horyzoncie - zlota godzina
    tintTop: [255, 140, 80, 0.4],
    tintMid: [140, 60, 110, 0.56],
    tintBottom: [0, 21, 98, 0.92],
    brightness: 0.92,
    saturate: 1.15,
    ray: [255, 190, 120, 0.6],
    particle: [255, 225, 190, 1],
    sun: [255, 170, 90, 0.9],
    moon: 0,
  },
  {
    alt: 8,
    tintTop: [255, 190, 130, 0.25],
    tintMid: [40, 60, 130, 0.55],
    tintBottom: [0, 21, 98, 0.92],
    brightness: 1,
    saturate: 1.05,
    ray: [255, 235, 200, 0.55],
    particle: [240, 240, 255, 1],
    sun: [255, 225, 170, 0.7],
    moon: 0,
  },
  {
    alt: 20, // dzien
    tintTop: [0, 21, 98, 0.35],
    tintMid: [0, 21, 98, 0.6],
    tintBottom: [0, 21, 98, 0.92],
    brightness: 1,
    saturate: 1,
    ray: [255, 255, 255, 0.55],
    particle: [220, 240, 255, 1],
    sun: [255, 250, 230, 0.35],
    moon: 0,
  },
];

const lerp = (a, b, t) => a + (b - a) * t;
const lerpArray = (a, b, t) => a.map((v, i) => lerp(v, b[i], t));
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const rgba = ([r, g, b, a]) => `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${+a.toFixed(3)})`;

function paletteAt(altitude) {
  if (altitude <= STOPS[0].alt) return STOPS[0];
  const last = STOPS[STOPS.length - 1];
  if (altitude >= last.alt) return last;
  const i = STOPS.findIndex((s) => altitude < s.alt) - 1;
  const from = STOPS[i];
  const to = STOPS[i + 1];
  const t = (altitude - from.alt) / (to.alt - from.alt);
  const out = {};
  for (const key of Object.keys(from)) {
    if (key === "alt") continue;
    out[key] = Array.isArray(from[key]) ? lerpArray(from[key], to[key], t) : lerp(from[key], to[key], t);
  }
  return out;
}

// Zmienne CSS dla .sidebar-water + kolor drobinek (rysowanych na canvasie,
// wiec poza CSS). sinAzimuth = sin(azymutu): wschod = 1 (prawa strona, jak na
// mapie), poludnie = 0, zachod = -1.
export function skyTheme(altitude, sinAzimuth) {
  const p = paletteAt(altitude);
  const [rayR, rayG, rayB, rayA] = p.ray;
  const sunVisible = clamp01((altitude + 4) / 8); // slonce gasnie tuz pod horyzontem
  return {
    vars: {
      "--water-tint-top": rgba(p.tintTop),
      "--water-tint-mid": rgba(p.tintMid),
      "--water-tint-bottom": rgba(p.tintBottom),
      "--water-brightness": p.brightness.toFixed(3),
      "--water-saturate": p.saturate.toFixed(3),
      "--ray-top": rgba([rayR, rayG, rayB, rayA]),
      "--ray-mid": rgba([rayR, rayG, rayB, rayA * 0.45]),
      "--sun-rgb": p.sun.slice(0, 3).map(Math.round).join(", "),
      "--sun-opacity": (p.sun[3] * sunVisible).toFixed(3),
      "--sun-x": `${(50 + 42 * sinAzimuth).toFixed(1)}%`,
      "--sun-y": `${Math.max(-5, 35 - Math.max(0, altitude) * 0.6).toFixed(1)}%`,
      "--moon-opacity": p.moon.toFixed(3),
    },
    particle: p.particle,
  };
}
