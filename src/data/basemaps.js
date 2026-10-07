// Podklady mapy - wszystkie bez klucza API. "dark" to dotychczasowe kafle OSM
// odwrocone filtrem CSS (klasa basemap-inverted w App.css), "none" rysuje
// sama siatke wspolrzednych na tle aplikacji.
const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const ESRI_CANVAS_ATTRIBUTION = "Tiles &copy; Esri &mdash; Esri, HERE, Garmin, &copy; OpenStreetMap contributors";
const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services";

export const BASEMAP_ORDER = ["dark", "night", "light", "satellite", "none"];

export const BASEMAPS = {
  dark: {
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: OSM_ATTRIBUTION,
    className: "basemap-inverted",
    tone: "dark",
  },
  night: {
    url: `${ESRI}/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
    attribution: ESRI_CANVAS_ATTRIBUTION,
    maxNativeZoom: 16,
    tone: "dark",
  },
  light: {
    url: `${ESRI}/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
    attribution: ESRI_CANVAS_ATTRIBUTION,
    maxNativeZoom: 16,
    tone: "light",
  },
  satellite: {
    url: `${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`,
    attribution: "Tiles &copy; Esri &mdash; Esri, Maxar, Earthstar Geographics, GIS User Community",
    tone: "dark",
  },
  none: { url: null, tone: "dark" },
};

// Miniatura do przelacznika: jeden kafel z5 obejmujacy srodkowy Baltyk.
const THUMB_TILE = { z: 5, x: 17, y: 9 };

export function basemapThumbUrl(key) {
  const url = BASEMAPS[key]?.url;
  if (!url) return null;
  return url
    .replace("{s}", "a")
    .replace("{z}", THUMB_TILE.z)
    .replace("{x}", THUMB_TILE.x)
    .replace("{y}", THUMB_TILE.y);
}
