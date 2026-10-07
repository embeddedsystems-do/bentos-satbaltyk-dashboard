import { useEffect, useState } from "react";
import PointChart from "./PointChart";
import { PRODUCT_ICONS } from "./icons";
import { PRODUCT_ORDER } from "./Sidebar";
import { useI18n } from "../i18n";

const PIN_LETTERS = "ABCDEFGHIJ";

// Glowny punkt w limonce marki (celowo najjasniejszy - to on jest "tematem"
// wykresu), porownywane w niebieskim i pomaranczowym. Trojka sprawdzona
// walidatorem palety na tle modala (wszystkie pary rozroznialne takze przy
// daltonizmie) - stad limit dwoch punktow do porownania.
const MAIN_COLOR = "#aaff00";
const COMPARE_COLORS = ["#3987e5", "#d95926"];

// Wykres startuje od warstwy aktywnej na mapie, ale parametr mozna zmienic
// zakladkami bez zamykania okna - kazdy produkt ma wlasne znaczniki czasu.
export default function ChartModal({ pins, pointId, products, initialProductKey, bbox, currentTime, onPickTime, onClose }) {
  const { t } = useI18n();
  const [productKey, setProductKey] = useState(initialProductKey);
  // id punktu -> indeks koloru; kolor zostaje przy punkcie, nawet gdy inny
  // punkt zostanie odznaczony (kolor idzie za punktem, nie za kolejnoscia).
  const [compare, setCompare] = useState({});
  const product = { ...products[productKey], label: t(`product.${productKey}`) };
  const entries = product.timestamps;

  const pointIndex = pins.findIndex((p) => p.id === pointId);
  const point = pins[pointIndex];
  const series = [
    { ...point, letter: PIN_LETTERS[pointIndex] ?? "?", color: MAIN_COLOR },
    ...pins
      .map((p, i) => ({ ...p, letter: PIN_LETTERS[i] ?? "?" }))
      .filter((p) => p.id in compare)
      .map((p) => ({ ...p, color: COMPARE_COLORS[compare[p.id]] })),
  ];
  const compareFull = Object.keys(compare).length >= COMPARE_COLORS.length;

  function toggleCompare(id) {
    setCompare((cur) => {
      if (id in cur) {
        const next = { ...cur };
        delete next[id];
        return next;
      }
      const used = new Set(Object.values(cur));
      const slot = COMPARE_COLORS.findIndex((_, i) => !used.has(i));
      return slot === -1 ? cur : { ...cur, [id]: slot };
    });
  }

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!point) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <span className="points-letter modal-letter">{PIN_LETTERS[pointIndex] ?? "?"}</span>
            <span className="modal-title">{product.label}</span>
            <div className="modal-subtitle">
              {point.lat.toFixed(3)}, {point.lon.toFixed(3)} · {entries.length}{" "}
              {t(entries.length === 1 ? "chart.frame.one" : "chart.frame.many")} {t("chart.range")}
            </div>
          </div>
          <button className="modal-close" onClick={onClose} aria-label={t("common.close")}>
            ×
          </button>
        </div>

        <div className="chart-metric-tabs" role="group" aria-label={t("chart.metric")}>
          {PRODUCT_ORDER.filter((key) => products[key]).map((key) => {
            const Icon = PRODUCT_ICONS[key];
            return (
              <button
                key={key}
                className={`buoy-chart-tab chart-metric-tab${productKey === key ? " is-active" : ""}`}
                onClick={() => setProductKey(key)}
                aria-pressed={productKey === key}
                title={t(`product.${key}`)}
              >
                {Icon && (
                  <span className="chart-metric-tab-icon">
                    <Icon />
                  </span>
                )}
                {t(`product.short.${key}`)}
              </button>
            );
          })}
        </div>

        {pins.length > 1 && (
          <div className="chart-points-row" role="group" aria-label={t("chart.points")}>
            <span className="chart-points-label">{t("chart.points")}</span>
            {pins.map((p, i) => {
              const isMain = p.id === pointId;
              const isOn = isMain || p.id in compare;
              const color = isMain ? MAIN_COLOR : isOn ? COMPARE_COLORS[compare[p.id]] : undefined;
              return (
                <button
                  key={p.id}
                  className={`chart-point-chip${isOn ? " is-on" : ""}${isMain ? " is-main" : ""}`}
                  onClick={() => toggleCompare(p.id)}
                  disabled={isMain || (!isOn && compareFull)}
                  aria-pressed={isOn}
                  title={`${p.lat.toFixed(3)}, ${p.lon.toFixed(3)}`}
                >
                  <span className="chart-swatch" style={color ? { background: color } : undefined} />
                  {PIN_LETTERS[i] ?? "?"}
                </button>
              );
            })}
            {compareFull && <span className="chart-points-limit">{t("chart.compareLimit")}</span>}
          </div>
        )}

        <PointChart
          series={series}
          product={product}
          entries={entries}
          bbox={bbox}
          currentTime={currentTime}
          onPickTime={onPickTime}
        />
      </div>
    </div>
  );
}
