import { useEffect, useRef, useState } from "react";
import BuoyCamera from "./BuoyCamera";
import BuoyChart, { BUOY_CHART_METRICS } from "./BuoyChart";
import { simulateBuoyReading } from "../utils/simulate";
import { degToCompass, formatTimestamp } from "../utils/grid";
import { useAnimatedNumber, shortestAngleDelta } from "../utils/useAnimatedNumber";
import { buoyPlace } from "../data/buoys";
import { useI18n } from "../i18n";

const clamp01 = (v) => Math.max(0, Math.min(1, v));

export default function BuoyModal({ buoy, timestampIso, entries = [], onPickTime, onClose }) {
  const { language, locale, t } = useI18n();
  const [pos, setPos] = useState(null); // null = domyslna pozycja z CSS (top-right); po przeciagnieciu {x,y}
  const [cameraOpen, setCameraOpen] = useState(false);
  const [chartOpen, setChartOpen] = useState(false);
  const [chartMetric, setChartMetric] = useState("waterTemp");
  const dragRef = useRef({ dragging: false, offsetX: 0, offsetY: 0 });
  const panelRef = useRef(null);

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    function moveTo(clientX, clientY) {
      const panelRect = panelRef.current.getBoundingClientRect();
      const mapEl = document.querySelector(".map-wrap");
      const bounds = mapEl
        ? mapEl.getBoundingClientRect()
        : { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };

      let x = clientX - dragRef.current.offsetX;
      let y = clientY - dragRef.current.offsetY;
      // nie pozwalamy wyciagnac panelu poza widoczny obszar mapy
      x = Math.min(Math.max(x, bounds.left), Math.max(bounds.left, bounds.right - panelRect.width));
      y = Math.min(Math.max(y, bounds.top), Math.max(bounds.top, bounds.bottom - panelRect.height));
      setPos({ x, y });
    }
    function onMouseMove(e) {
      if (!dragRef.current.dragging) return;
      moveTo(e.clientX, e.clientY);
    }
    function onTouchMove(e) {
      if (!dragRef.current.dragging) return;
      const t = e.touches[0];
      if (t) moveTo(t.clientX, t.clientY);
    }
    function onUp() {
      dragRef.current.dragging = false;
    }
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", onUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onUp);
    };
  }, []);

  function startDragAt(clientX, clientY) {
    const rect = panelRef.current.getBoundingClientRect();
    dragRef.current = { dragging: true, offsetX: clientX - rect.left, offsetY: clientY - rect.top };
  }

  function handleDragStart(e) {
    startDragAt(e.clientX, e.clientY);
    e.preventDefault();
  }

  function handleTouchDragStart(e) {
    const t = e.touches[0];
    if (t) startDragAt(t.clientX, t.clientY);
  }

  const r = simulateBuoyReading(buoy.id, timestampIso);

  // Animowane (rAF, ease-out) wartosci - przy przejsciu na nowa klatke czasu
  // liczby i paski plynnie "dobiegaja" do nowego odczytu zamiast skakac.
  const waterTemp = useAnimatedNumber(r.waterTemp);
  const waveHeight = useAnimatedNumber(r.waveHeight);
  const windSpeed = useAnimatedNumber(r.windSpeed);
  const windDir = useAnimatedNumber(r.windDir, { deltaFn: shortestAngleDelta });
  const pressure = useAnimatedNumber(r.pressure);
  const battery = useAnimatedNumber(r.battery);
  const signal = useAnimatedNumber(r.signal);
  const detailsOpen = cameraOpen || chartOpen;

  const tiles = [
    { label: t("buoy.metric.waterTemp"), value: waterTemp.toFixed(1), unit: "°C", frac: clamp01(waterTemp / 25) },
    { label: t("buoy.metric.waveHeight"), value: waveHeight.toFixed(2), unit: "m", frac: clamp01(waveHeight / 3) },
    {
      label: t("buoy.metric.windSpeed"),
      value: windSpeed.toFixed(0),
      unit: `km/h ${degToCompass(((windDir % 360) + 360) % 360)}`,
      frac: clamp01(windSpeed / 40),
    },
    { label: t("buoy.metric.pressure"), value: pressure.toFixed(0), unit: "hPa", frac: clamp01((pressure - 970) / 70) },
    { label: t("buoy.metric.battery"), value: Math.round(battery), unit: "%", frac: clamp01(battery / 100) },
    { label: t("buoy.metric.signal"), value: Math.round(signal), unit: "/5", frac: clamp01(signal / 5) },
  ];

  return (
    <div
      className={`buoy-panel${detailsOpen ? " has-details" : ""}`}
      ref={panelRef}
      style={pos ? { left: pos.x, top: pos.y, right: "auto" } : undefined}
    >
      <div
        className="modal-header buoy-panel-handle"
        onMouseDown={handleDragStart}
        onTouchStart={handleTouchDragStart}
      >
        <div>
          <span className="modal-title">{t("buoy.title", { name: buoy.name })}</span>
          <span className="buoy-sim-tag">{t("common.simulation")}</span>
          <div className="modal-subtitle">
            {buoyPlace(buoy, language)} · {buoy.lat.toFixed(4)}, {buoy.lon.toFixed(4)}
          </div>
        </div>
        <button className="modal-close" onClick={onClose} aria-label={t("common.close")}>
          ×
        </button>
      </div>

      <div className="buoy-panel-body">
        <div className="buoy-panel-data">
          <div className="stream-eyebrow">
            <span className="stream-eyebrow-highlight">{t("buoy.preview")}</span>
          </div>
          <div className="buoy-stream">
            <div className="buoy-stream-header">
              <span className="buoy-stream-live">
                <span className="buoy-live-dot" />
                {t("buoy.stream")}
              </span>
              <span className="buoy-stream-time">{timestampIso ? formatTimestamp(timestampIso, locale) : "—"}</span>
            </div>

            <div className="buoy-telemetry">
              {tiles.map((t) => (
                <div className="buoy-stat" key={t.label}>
                  <span className="buoy-stat-label">{t.label}</span>
                  <span className="buoy-stat-value">
                    {t.value} <small>{t.unit}</small>
                  </span>
                  <span className="buoy-stat-bar">
                    <span className="buoy-stat-bar-fill" style={{ width: `${t.frac * 100}%` }} />
                  </span>
                </div>
              ))}
            </div>

            <div className="buoy-stream-footer">{t("buoy.footer")}</div>
          </div>

          <div className="buoy-detail-controls">
            <div className="buoy-detail-control">
              <span>{t("buoy.camera")}</span>
              <button className="buoy-chart-toggle" onClick={() => setCameraOpen((v) => !v)}>
                {t(cameraOpen ? "buoy.hideCamera" : "buoy.showCamera")}
              </button>
            </div>
            <div className="buoy-detail-control">
              <span>{t("buoy.history")}</span>
              <button className="buoy-chart-toggle" onClick={() => setChartOpen((v) => !v)}>
                {t(chartOpen ? "buoy.hideChart" : "buoy.showChart")}
              </button>
            </div>
          </div>

          <p className="buoy-disclaimer">
            {t("buoy.disclaimer")}
          </p>
        </div>

        {detailsOpen && (
          <div className="buoy-panel-details">
            {cameraOpen && <BuoyCamera />}
            {chartOpen && (
              <div className="buoy-chart-panel">
                <div className="buoy-chart-tabs">
                  {Object.entries(BUOY_CHART_METRICS).map(([key, metric]) => (
                    <button
                      key={key}
                      className={`buoy-chart-tab${chartMetric === key ? " is-active" : ""}`}
                      onClick={() => setChartMetric(key)}
                    >
                      {t(metric.labelKey)}
                    </button>
                  ))}
                </div>
                <BuoyChart
                  buoy={buoy}
                  entries={entries}
                  metricKey={chartMetric}
                  currentTime={timestampIso}
                  onPickTime={onPickTime}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
