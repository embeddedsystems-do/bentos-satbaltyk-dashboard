import { MapContainer, TileLayer, ImageOverlay, Marker, useMap, useMapEvents } from "react-leaflet";
import { useEffect, useMemo, useRef, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { PRODUCT_ICONS, BuoyIcon } from "./icons";
import { BUOYS } from "../data/buoys";
import { BASEMAPS } from "../data/basemaps";
import Graticule from "./Graticule";
import CompareSwipe from "./CompareSwipe";
import { useI18n } from "../i18n";

const PIN_LETTERS = "ABCDEFGHIJ";
const BALTIC_CENTER = [58.7, 20.4];
const BALTIC_MAX_BOUNDS = [
  [53.0, 9.0],
  [66.5, 31.5],
];

function buildPinIcon(Icon, letter, isSelected) {
  const html = renderToStaticMarkup(
    <div className={`pin-marker${isSelected ? " is-selected" : ""}`}>
      <span className="pin-marker-ring" />
      <span className="pin-marker-icon">
        <Icon />
      </span>
      <span className="pin-marker-letter">{letter}</span>
    </div>
  );
  return L.divIcon({
    html,
    className: "pin-marker-wrap",
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}

function buildBuoyIcon(isSelected) {
  return L.divIcon({
    html: renderToStaticMarkup(
      <div className={`buoy-marker${isSelected ? " is-selected" : ""}`}>
        <span className="buoy-marker-ring" />
        <span className="buoy-marker-icon">
          <BuoyIcon />
        </span>
      </div>
    ),
    className: "pin-marker-wrap",
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}

// Jeden nasluch zdarzen mapy: mysz karmi "celownik" (pozycja w pikselach
// kontenera + wartosc pod kursorem), klik dodaje punkt albo zdejmuje
// zaznaczenie. Na dotyku przegladarka emuluje mousemove przy tapnieciu, a
// mouseout nigdy nie przychodzi - celownik zostawalby na ekranie na zawsze,
// wiec tam pokazujemy go tylko jako "sonde" po tapnieciu w pusta mape.
function MapInteractions({ onProbe, onMapClick, hasSelection, pinMode }) {
  const map = useMap();
  const pointerTypeRef = useRef("mouse");

  useEffect(() => {
    const container = map.getContainer();
    const track = (e) => {
      pointerTypeRef.current = e.pointerType;
    };
    container.addEventListener("pointerdown", track, true);
    container.addEventListener("pointermove", track, true);
    return () => {
      container.removeEventListener("pointerdown", track, true);
      container.removeEventListener("pointermove", track, true);
    };
  }, [map]);

  const isMouse = () => pointerTypeRef.current === "mouse";

  useMapEvents({
    mousemove(e) {
      if (isMouse()) onProbe(e);
    },
    mouseout() {
      if (isMouse()) onProbe(null);
    },
    movestart() {
      if (!isMouse()) onProbe(null);
    },
    click(e) {
      if (!isMouse()) onProbe(pinMode || hasSelection ? null : e);
      onMapClick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

// Leaflet sam sledzi tylko resize okna - chowanie panelu zmienia szerokosc
// kontenera bez resize okna, wiec bez tego zostaje pusty pas bez kafli.
function FitContainer() {
  const map = useMap();
  useEffect(() => {
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [map]);
  return null;
}

// Przy porownaniu warstw kazdy punkt lezy po jednej ze stron granicy, wiec jego
// ikona ma pokazywac warstwe z tej strony. Strona wynika z polozenia punktu w
// pikselach kontenera (zmienia sie przy przesuwaniu mapy, zoomie i uchwycie).
function PinSideTracker({ pins, split, active, onChange }) {
  const map = useMap();

  function update() {
    const width = map.getSize().x;
    const next = {};
    if (active) {
      for (const p of pins) {
        next[p.id] = map.latLngToContainerPoint([p.lat, p.lon]).x > width * split ? "right" : "left";
      }
    }
    onChange((prev) => {
      const keys = Object.keys(next);
      return keys.length === Object.keys(prev).length && keys.every((k) => prev[k] === next[k]) ? prev : next;
    });
  }

  useEffect(update, [map, pins, split, active]);
  useMapEvents({ move: update, zoomend: update, resize: update });
  return null;
}

// Panel boczny nakłada się na mapę, więc granice nawigacji poszerzamy na zachód
// o jego szerokość (przeliczoną na stopnie dla aktualnego zoomu) - inaczej
// dane przy zachodniej krawędzi dałoby się przesunąć co najwyżej pod panel.
// Margines jest stały, niezależny od tego, czy panel jest otwarty, żeby
// chowanie panelu nigdy nie przesuwało mapy.
function WestMargin({ px }) {
  const map = useMap();
  function apply() {
    const degrees = (px * 360) / (256 * 2 ** map.getZoom());
    map.setMaxBounds([
      [BALTIC_MAX_BOUNDS[0][0], BALTIC_MAX_BOUNDS[0][1] - degrees],
      BALTIC_MAX_BOUNDS[1],
    ]);
  }
  useEffect(apply, [map, px]); // eslint-disable-line react-hooks/exhaustive-deps
  useMapEvents({ zoomend: apply });
  return null;
}

export default function MapView({
  bbox,
  imageUrl,
  productKey,
  hoverLabel,
  pins,
  selectedPinId,
  pinMode,
  buoysVisible,
  selectedBuoyId,
  basemap,
  showGraticule,
  westMargin = 0, // px dodatkowego marginesu nawigacji na zachód (szerokość panelu bocznego na desktopie)
  leftInset, // px mapy zasłonięte z lewej przez panel boczny (mapa ma zawsze pełną szerokość)
  compare, // { imageUrl, productKey } | null - druga warstwa po prawej stronie suwaka
  onHover,
  onPinClick,
  onMapClick,
  onBuoyClick,
}) {
  const { t } = useI18n();
  const bounds = useMemo(() => {
    const [lonMin, latMin, lonMax, latMax] = bbox;
    return [
      [latMin, lonMin],
      [latMax, lonMax],
    ];
  }, [bbox]);

  const [cursor, setCursor] = useState(null); // {x,y,side} w pikselach kontenera mapy
  const [split, setSplit] = useState(0.5); // polozenie granicy porownania (ulamek szerokosci mapy)
  const [pinSides, setPinSides] = useState({}); // id punktu -> "left" | "right" (tylko przy porownaniu)
  const handleActiveRef = useRef(false); // kursor nad uchwytem porownania albo jego przeciaganie - bez celownika
  const mapRef = useRef(null);
  const Icon = PRODUCT_ICONS[cursor?.side === "right" ? compare?.productKey : productKey] ?? PRODUCT_ICONS[productKey];
  const tiles = BASEMAPS[basemap] ?? BASEMAPS.dark;

  // Przy porownaniu warstw celownik odczytuje warstwe z tej strony granicy, nad ktora jest kursor.
  function probe(e) {
    if (!e || handleActiveRef.current) {
      setCursor(null);
      onHover(null, null);
      return;
    }
    const width = mapRef.current?.getSize().x ?? 0;
    const side = compare && e.containerPoint.x > width * split ? "right" : "left";
    setCursor({ x: e.containerPoint.x, y: e.containerPoint.y, side });
    onHover(e.latlng.lat, e.latlng.lng, side);
  }

  // MapContainer ustawia className tylko przy pierwszym renderze, wiec klase
  // trybu dodawania punktow (celownik, podglad usuwania) przelaczamy recznie.
  useEffect(() => {
    mapRef.current?.getContainer().classList.toggle("map-armed", pinMode);
  }, [pinMode]);

  const pinIcons = useMemo(
    () =>
      pins.map((pin, i) => {
        const key = compare && pinSides[pin.id] === "right" ? compare.productKey : productKey;
        return buildPinIcon(PRODUCT_ICONS[key], PIN_LETTERS[i] ?? "?", pin.id === selectedPinId);
      }),
    [pins, productKey, compare?.productKey, pinSides, selectedPinId]
  );

  const buoyIcons = useMemo(
    () => Object.fromEntries(BUOYS.map((b) => [b.id, buildBuoyIcon(b.id === selectedBuoyId)])),
    [selectedBuoyId]
  );

  return (
    <MapContainer
      center={BALTIC_CENTER}
      zoom={5}
      minZoom={5}
      maxZoom={13}
      maxBounds={BALTIC_MAX_BOUNDS}
      maxBoundsViscosity={1.0}
      className="map"
      preferCanvas
      ref={mapRef}
    >
      {/* Podklad wybierany w BasemapControl. key wymusza nowa warstwe przy
          zmianie - Leaflet nie aktualizuje atrybucji ani className w locie.
          Domyslny "dark" to kafle OSM przyciemnione filtrem CSS (basemap-inverted
          w App.css), zeby paleta nakladki nie gryzla sie z jasna mapa. */}
      {tiles.url && (
        <TileLayer
          key={basemap}
          url={tiles.url}
          attribution={tiles.attribution}
          maxNativeZoom={tiles.maxNativeZoom}
          className={tiles.className ?? ""}
        />
      )}
      {imageUrl && <ImageOverlay url={imageUrl} bounds={bounds} opacity={0.88} />}
      {compare && (
        <CompareSwipe
          imageUrl={compare.imageUrl}
          bounds={bounds}
          split={split}
          onSplitChange={setSplit}
          leftInset={leftInset}
          onHandleActive={(active) => {
            handleActiveRef.current = active;
            if (active) probe(null);
          }}
          leftKey={productKey}
          rightKey={compare.productKey}
        />
      )}

      <PinSideTracker pins={pins} split={split} active={Boolean(compare)} onChange={setPinSides} />

      {pins.map((p, i) => (
        <Marker
          key={p.id}
          position={[p.lat, p.lon]}
          icon={pinIcons[i]}
          eventHandlers={{
            click: (e) => {
              L.DomEvent.stopPropagation(e);
              probe(null);
              onPinClick(p.id);
            },
          }}
        />
      ))}

      {buoysVisible &&
        BUOYS.map((b) => (
          <Marker
            key={b.id}
            position={[b.lat, b.lon]}
            icon={buoyIcons[b.id]}
            eventHandlers={{
              click: (e) => {
                L.DomEvent.stopPropagation(e);
                probe(null);
                onBuoyClick(b.id);
              },
            }}
          />
        ))}

      {(showGraticule || !tiles.url) && <Graticule tone={tiles.tone} />}

      <FitContainer />
      <WestMargin px={westMargin} />

      <MapInteractions
        onProbe={probe}
        onMapClick={onMapClick}
        hasSelection={Boolean(selectedBuoyId || selectedPinId)}
        pinMode={pinMode}
      />

      {pinMode && <div className="pin-mode-hint">{t("map.addHint")}</div>}

      {cursor && (
        <div className="measure-cursor" style={{ left: cursor.x, top: cursor.y }}>
          <span className="measure-cursor-dot">
            <Icon />
          </span>
          {hoverLabel && <span className="measure-cursor-label">{hoverLabel}</span>}
        </div>
      )}
    </MapContainer>
  );
}
