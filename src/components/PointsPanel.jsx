import { useI18n } from "../i18n";

const PIN_LETTERS = "ABCDEFGHIJ";

export default function PointsPanel({
  points,
  selectedPointId,
  pinMode,
  onTogglePinMode,
  onRemove,
  onClear,
  onSelect,
  onShowChart,
}) {
  const { t } = useI18n();
  return (
    <section className="panel points-panel">
      <div className="points-panel-head">
        <h2>{t("points.title")}</h2>
        {points.length > 0 && (
          <button className="points-clear" onClick={onClear}>
            {t("points.clear")}
          </button>
        )}
      </div>

      <button
        className={`points-add-btn${pinMode ? " is-armed" : ""}`}
        onClick={onTogglePinMode}
        aria-pressed={pinMode}
      >
        {t(pinMode ? "points.finish" : "points.add")}
      </button>

      {points.length === 0 ? (
        <p className="points-empty">
          {pinMode
            ? t("points.emptyArmed")
            : t("points.empty")}
        </p>
      ) : (
        <ul className="points-list">
          {points.map((p, i) => (
            <li key={p.id} className={`points-row${selectedPointId === p.id ? " is-selected" : ""}`}>
              <div className="points-row-top">
                <button className="points-select" onClick={() => onSelect(p.id)} aria-pressed={selectedPointId === p.id}>
                  <span className="points-letter">{PIN_LETTERS[i] ?? "?"}</span>
                  <span className="points-coords">
                    {p.lat.toFixed(3)}, {p.lon.toFixed(3)}
                  </span>
                </button>
                <button className="points-remove" onClick={() => onRemove(p.id)} aria-label={t("points.remove")}>
                  ×
                </button>
              </div>
              <div className="points-row-bottom">
                <span className={`points-value${p.label ? "" : " points-value-empty"}`}>
                  {p.label ?? t("common.noData")}
                </span>
                <button className="points-chart-btn" onClick={() => onShowChart(p.id)}>
                  {t("points.chart")}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
