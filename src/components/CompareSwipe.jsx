import { useEffect, useRef, useState } from "react";
import { ImageOverlay, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import { PRODUCT_ICONS } from "./icons";
import { useI18n } from "../i18n";

const PANE = "compare";

// Porownanie dwoch warstw "suwakiem": druga warstwa lezy we wlasnym panelu nad
// glowna nakladka i jest przycinana do prawej strony od granicy. Panel siedzi
// w mapPane, ktory Leaflet przesuwa przy przeciaganiu mapy, wiec przyciecie
// liczymy we wspolrzednych warstwy (layer point) i odswiezamy przy kazdym ruchu.
// Glowna nakladka (overlayPane) jest przycinana symetrycznie do lewej strony -
// inaczej przeswitywalaby po prawej tam, gdzie druga warstwa nie ma danych.
export default function CompareSwipe({ imageUrl, bounds, split, onSplitChange, onHandleActive, leftInset = 0, leftKey, rightKey }) {
  const map = useMap();
  const { t } = useI18n();
  const handleRef = useRef(null);
  const [pane] = useState(() => {
    const existing = map.getPane(PANE) ?? map.createPane(PANE);
    existing.style.zIndex = 405; // nad overlayPane (400), pod siatka i znacznikami
    return existing;
  });
  const [, setFrame] = useState(0);

  function updateClip() {
    const size = map.getSize();
    const nw = map.containerPointToLayerPoint([0, 0]);
    const se = map.containerPointToLayerPoint(size);
    const splitX = nw.x + size.x * split;
    pane.style.clip = `rect(${nw.y}px, ${se.x}px, ${se.y}px, ${splitX}px)`;
    map.getPane("overlayPane").style.clip = `rect(${nw.y}px, ${splitX}px, ${se.y}px, ${nw.x}px)`;
  }

  useEffect(updateClip);
  useEffect(() => {
    return () => {
      pane.style.clip = "";
      map.getPane("overlayPane").style.clip = "";
    };
  }, [map, pane]);

  useMapEvents({
    move: updateClip,
    zoomend: updateClip,
    resize: () => {
      updateClip();
      setFrame((f) => f + 1);
    },
  });

  // Przeciaganie uchwytu nie moze przesuwac mapy ani wyzwalac kliku (dodawania punktu).
  useEffect(() => {
    const el = handleRef.current;
    if (!el) return;
    L.DomEvent.disableClickPropagation(el);
    L.DomEvent.disableScrollPropagation(el);
  }, []);

  // Granica nie moze wejsc pod panel boczny (zaslania mape z lewej) - uchwyt
  // zniknalby i nie dalo sie go zlapac. Panel otwierany przy granicy, ktora
  // juz tam jest, odsuwa ja na krawedz panelu.
  const minSplit = () => Math.max(0.05, (leftInset + 24) / map.getSize().x);

  function moveTo(clientX) {
    const rect = map.getContainer().getBoundingClientRect();
    const frac = (clientX - rect.left) / rect.width;
    onSplitChange(Math.min(0.95, Math.max(minSplit(), frac)));
  }

  useEffect(() => {
    if (split < minSplit()) onSplitChange(minSplit());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leftInset]);

  // Nad uchwytem (i podczas przeciagania) celownik z odczytem wartosci sie
  // chowa - inaczej "chodzilby" za kursorem razem z przesuwana granica.
  const hoveringRef = useRef(false);
  const draggingRef = useRef(false);
  function reportActive() {
    onHandleActive?.(hoveringRef.current || draggingRef.current);
  }
  useEffect(() => () => onHandleActive?.(false), []); // eslint-disable-line react-hooks/exhaustive-deps

  function onPointerDown(e) {
    e.currentTarget.setPointerCapture(e.pointerId);
    draggingRef.current = true;
    reportActive();
    moveTo(e.clientX);
  }

  function onPointerEnter() {
    hoveringRef.current = true;
    reportActive();
  }

  function onPointerLeave() {
    hoveringRef.current = false;
    reportActive();
  }

  function onPointerEnd() {
    draggingRef.current = false;
    reportActive();
  }

  function onPointerMove(e) {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) moveTo(e.clientX);
  }

  function onKeyDown(e) {
    const step = e.shiftKey ? 0.1 : 0.02;
    if (e.key === "ArrowLeft") onSplitChange(Math.max(minSplit(), split - step));
    if (e.key === "ArrowRight") onSplitChange(Math.min(0.95, split + step));
  }

  const LeftIcon = PRODUCT_ICONS[leftKey];
  const RightIcon = PRODUCT_ICONS[rightKey];

  return (
    <>
      {imageUrl && <ImageOverlay url={imageUrl} bounds={bounds} opacity={0.88} pane={PANE} />}
      <div className="compare-divider" style={{ left: `${split * 100}%` }}>
        <div
          ref={handleRef}
          className="compare-handle"
          role="slider"
          tabIndex={0}
          aria-label={t("compare.handle")}
          aria-valuemin={5}
          aria-valuemax={95}
          aria-valuenow={Math.round(split * 100)}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerEnter={onPointerEnter}
          onPointerLeave={onPointerLeave}
          onLostPointerCapture={onPointerEnd}
          onKeyDown={onKeyDown}
        >
          <span className="compare-side is-left">
            {LeftIcon && <LeftIcon />}
            {t(`product.short.${leftKey}`)}
          </span>
          <span className="compare-knob" aria-hidden="true">
            ‹ ›
          </span>
          <span className="compare-side is-right">
            {RightIcon && <RightIcon />}
            {t(`product.short.${rightKey}`)}
          </span>
        </div>
      </div>
    </>
  );
}
