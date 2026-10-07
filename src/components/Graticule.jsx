import { useMemo, useState } from "react";
import { Pane, Polyline, useMap, useMapEvents } from "react-leaflet";

// Kroki siatki w minutach katowych - "okragle" wartosci, ktore da sie
// czytelnie opisac (5°, 1°, 30′, 10′...).
const STEPS_MIN = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
const MIN_SPACING_PX = 90; // linie gesciej niz co ~90 px zamieniaja mape w kratke

function pickStep(pxPerDeg) {
  return STEPS_MIN.find((step) => (step / 60) * pxPerDeg >= MIN_SPACING_PX) ?? STEPS_MIN[STEPS_MIN.length - 1];
}

// Wielokrotnosci kroku w przedziale - liczone na calkowitych minutach, zeby
// nie zbierac bledow zmiennoprzecinkowych (54.49999...).
function multiples(min, max, stepMin) {
  const out = [];
  for (let k = Math.ceil((min * 60) / stepMin); k <= Math.floor((max * 60) / stepMin); k++) {
    out.push((k * stepMin) / 60);
  }
  return out;
}

function formatCoord(value, pos, neg) {
  const totalMin = Math.round(Math.abs(value) * 60);
  const deg = Math.floor(totalMin / 60);
  const min = totalMin % 60;
  const hemi = value >= 0 ? pos : neg;
  return min ? `${deg}°${String(min).padStart(2, "0")}′${hemi}` : `${deg}°${hemi}`;
}

// Linie liczymy na obszarze wiekszym od widoku (pad), zeby przy przesuwaniu
// mapy nie bylo pustych brzegow do czasu przeliczenia na moveend.
function computeLines(map) {
  const view = map.getBounds();
  const size = map.getSize();
  const lonStep = pickStep(size.x / (view.getEast() - view.getWest()));
  const latStep = pickStep(size.y / (view.getNorth() - view.getSouth()));
  const area = view.pad(0.5);
  return {
    south: area.getSouth(),
    north: area.getNorth(),
    west: area.getWest(),
    east: area.getEast(),
    meridians: multiples(area.getWest(), area.getEast(), lonStep),
    parallels: multiples(area.getSouth(), area.getNorth(), latStep),
  };
}

// Siatka wspolrzednych: linie we wlasnym panelu nad nakladka z danymi (pod
// znacznikami), opisy przy gornej i lewej krawedzi mapy. Opisy sa zwyklym
// DOM-em w pikselach kontenera, wiec na czas animacji zoomu je chowamy.
export default function Graticule({ tone = "dark" }) {
  const map = useMap();
  const [lines, setLines] = useState(() => computeLines(map));
  const [, setFrame] = useState(0);
  const [zooming, setZooming] = useState(false);

  useMapEvents({
    move: () => setFrame((f) => f + 1),
    moveend: () => setLines(computeLines(map)),
    zoomstart: () => setZooming(true),
    zoomend: () => {
      setZooming(false);
      setLines(computeLines(map));
    },
    resize: () => setLines(computeLines(map)),
  });

  const pathOptions = useMemo(
    () => ({
      color: tone === "light" ? "#001562" : "#ffffff",
      opacity: tone === "light" ? 0.28 : 0.2,
      weight: 1,
      interactive: false,
    }),
    [tone]
  );

  const view = map.getBounds();
  const center = view.getCenter();
  const size = map.getSize();
  const lonLabels = lines.meridians
    .filter((lon) => lon > view.getWest() && lon < view.getEast())
    .map((lon) => ({ key: lon, x: map.latLngToContainerPoint([center.lat, lon]).x, text: formatCoord(lon, "E", "W") }))
    .filter((l) => l.x > 60 && l.x < size.x - 30);
  const latLabels = lines.parallels
    .filter((lat) => lat > view.getSouth() && lat < view.getNorth())
    .map((lat) => ({ key: lat, y: map.latLngToContainerPoint([lat, center.lng]).y, text: formatCoord(lat, "N", "S") }))
    .filter((l) => l.y > 130 && l.y < size.y - 20);

  return (
    <>
      <Pane name="graticule" style={{ zIndex: 450 }}>
        {lines.meridians.map((lon) => (
          <Polyline
            key={`m${lon}`}
            positions={[
              [lines.south, lon],
              [lines.north, lon],
            ]}
            pathOptions={pathOptions}
          />
        ))}
        {lines.parallels.map((lat) => (
          <Polyline
            key={`p${lat}`}
            positions={[
              [lat, lines.west],
              [lat, lines.east],
            ]}
            pathOptions={pathOptions}
          />
        ))}
      </Pane>
      <div className={`graticule-labels is-${tone}${zooming ? " is-hidden" : ""}`} aria-hidden="true">
        {lonLabels.map((l) => (
          <span key={`m${l.key}`} className="graticule-label is-lon" style={{ left: l.x }}>
            {l.text}
          </span>
        ))}
        {latLabels.map((l) => (
          <span key={`p${l.key}`} className="graticule-label is-lat" style={{ top: l.y }}>
            {l.text}
          </span>
        ))}
      </div>
    </>
  );
}
