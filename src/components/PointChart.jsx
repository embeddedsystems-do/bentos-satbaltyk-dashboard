import { useEffect, useRef, useState } from "react";
import { loadPointsSeries, formatTimestampShort, degToCompass } from "../utils/grid";
import { nearestPointIndex } from "../utils/chartAxis";
import { useI18n } from "../i18n";
import ChartTimeAxis from "./ChartTimeAxis";

const WIDTH = 620;
const HEIGHT = 260;
const PAD = { top: 22, right: 16, bottom: 40, left: 46 };
const INNER_W = WIDTH - PAD.left - PAD.right;
const INNER_H = HEIGHT - PAD.top - PAD.bottom;

function splitSegments(series) {
  const segments = [];
  let current = [];
  for (const d of series) {
    if (d.value == null) {
      if (current.length) segments.push(current);
      current = [];
    } else {
      current.push(d);
    }
  }
  if (current.length) segments.push(current);
  return segments;
}

function formatValue(product, value, t) {
  if (value == null) return t("common.noData");
  return product.circular ? `${value.toFixed(0)}° (${degToCompass(value)})` : `${value.toFixed(2)} ${product.unit}`;
}

// series: [{ id, letter, color, lat, lon }] - pierwsza to punkt, dla ktorego
// otwarto wykres, kolejne to punkty dobrane do porownania. Wszystkie serie
// maja te same znaczniki czasu (ten sam produkt), wiec dziela os X i celownik.
// Przerywana linia "mapa" pokazuje moment ustawiony na mapie, a klik w wykres
// przestawia mape na wskazany moment (onPickTime).
export default function PointChart({ series: requested, product, entries, bbox, currentTime, onPickTime }) {
  const { locale, t } = useI18n();
  // Zaladowane serie trzymamy po id punktu (razem z entries, dla ktorych je
  // policzono) - po odznaczeniu punktu jego seria po prostu znika z rysunku,
  // a nowo dodana pojawia sie po doladowaniu, bez mieszania indeksow.
  const [loaded, setLoaded] = useState(null); // { entries, byId: { [id]: [{t, value}] } }
  const [hoverIdx, setHoverIdx] = useState(null);
  const svgRef = useRef(null);
  const coordsKey = requested.map((s) => `${s.id}:${s.lat},${s.lon}`).join(";");

  useEffect(() => {
    let cancelled = false;
    loadPointsSeries(entries, bbox, requested)
      .then((rows) => {
        if (!cancelled) setLoaded({ entries, byId: Object.fromEntries(requested.map((s, i) => [s.id, rows[i]])) });
      })
      .catch(() => {
        if (!cancelled) setLoaded({ entries, byId: Object.fromEntries(requested.map((s) => [s.id, []])) });
      });
    return () => {
      cancelled = true;
    };
    // serie identyfikuje zestaw id/wspolrzednych - nowa tablica przy kazdym renderze nie ma znaczenia
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, bbox, coordsKey]);

  // Rysujemy tylko serie, ktore sa juz zaladowane dla biezacego produktu.
  const byId = loaded?.entries === entries ? loaded.byId : null;
  const series = byId ? requested.filter((s) => byId[s.id]) : [];
  if (!byId || !byId[requested[0].id]) {
    return <p className="chart-status">{t("chart.loading", { count: entries.length })}</p>;
  }
  const data = series.map((s) => byId[s.id]);

  const values = data.flat().filter((d) => d.value != null).map((d) => d.value);
  if (values.length === 0 || !data[0].length) {
    return <p className="chart-status">{t("chart.noData")}</p>;
  }

  const base = data[0];
  const times = base.map((d) => new Date(d.t).getTime());
  const tMin = times[0];
  const tMax = times[times.length - 1];
  const span = tMax - tMin || 1;

  let vMin, vMax;
  if (product.circular) {
    vMin = 0;
    vMax = 360;
  } else {
    vMin = Math.min(...values);
    vMax = Math.max(...values);
    if (vMin === vMax) {
      vMin -= 1;
      vMax += 1;
    } else {
      const pad = (vMax - vMin) * 0.12;
      vMin -= pad;
      vMax += pad;
    }
  }

  const xFor = (time) => PAD.left + ((time - tMin) / span) * INNER_W;
  const yFor = (v) => PAD.top + INNER_H - ((v - vMin) / (vMax - vMin)) * INNER_H;
  const bottom = PAD.top + INNER_H;
  const single = series.length === 1;

  const plotted = data.map((rows) =>
    rows.map((d, i) => ({ ...d, x: xFor(times[i]), y: d.value == null ? null : yFor(d.value) }))
  );

  const yTicks = product.circular
    ? [0, 90, 180, 270, 360]
    : Array.from({ length: 4 }, (_, i) => vMin + ((vMax - vMin) * i) / 3);

  const mapTime = currentTime ? new Date(currentTime).getTime() : null;
  const mapX = mapTime != null && mapTime >= tMin && mapTime <= tMax ? xFor(mapTime) : null;

  function handleMove(evt) {
    setHoverIdx(nearestPointIndex(svgRef.current, evt, plotted[0], WIDTH));
  }

  function handleClick(evt) {
    const idx = nearestPointIndex(svgRef.current, evt, plotted[0], WIDTH);
    onPickTime?.(base[idx].t);
  }

  const hoverX = hoverIdx != null ? plotted[0][hoverIdx].x : null;

  return (
    <div className="chart-wrap">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className={`chart-svg${onPickTime ? " is-pickable" : ""}`}
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverIdx(null)}
        onClick={handleClick}
      >
        {yTicks.map((v, i) => {
          const y = yFor(v);
          return (
            <g key={i}>
              <line x1={PAD.left} x2={WIDTH - PAD.right} y1={y} y2={y} className="chart-gridline" />
              <text x={PAD.left - 8} y={y} className="chart-axis-label" textAnchor="end" dominantBaseline="middle">
                {product.circular ? degToCompass(v) : v.toFixed(1)}
              </text>
            </g>
          );
        })}

        <ChartTimeAxis
          series={base}
          times={times}
          xFor={xFor}
          y={bottom + 16}
          count={6}
          labelWidth={44}
          gap={18}
          locale={locale}
        />

        {mapX != null && (
          <g className="chart-map-marker">
            <line x1={mapX} x2={mapX} y1={PAD.top} y2={bottom} />
            <text
              x={mapX}
              y={PAD.top - 7}
              textAnchor={mapX > WIDTH - 40 ? "end" : mapX < PAD.left + 30 ? "start" : "middle"}
            >
              {t("chart.mapTime")}
            </text>
          </g>
        )}

        {/* Kolejnosc odwrocona: glowny punkt rysowany na koncu, czyli na wierzchu. */}
        {[...plotted].reverse().map((points, ri) => {
          const s = series[plotted.length - 1 - ri];
          if (product.circular) {
            return (
              <g key={s.id}>
                {points
                  .filter((p) => p.value != null)
                  .map((p, i) => (
                    <circle key={i} cx={p.x} cy={p.y} r={3.5} className="chart-dot" style={{ fill: s.color }} />
                  ))}
              </g>
            );
          }
          return (
            <g key={s.id}>
              {splitSegments(points).map((seg, i) => {
                const line = `M${seg.map((d) => `${d.x},${d.y}`).join(" L")}`;
                return (
                  <g key={i}>
                    <path d={line} fill="none" className="chart-line" style={{ stroke: s.color }} />
                    {single && (
                      <path
                        d={`${line} L${seg[seg.length - 1].x},${bottom} L${seg[0].x},${bottom} Z`}
                        className="chart-area"
                      />
                    )}
                  </g>
                );
              })}
            </g>
          );
        })}

        {hoverX != null && <line x1={hoverX} x2={hoverX} y1={PAD.top} y2={bottom} className="chart-crosshair" />}
        {hoverIdx != null &&
          plotted.map((points, i) =>
            points[hoverIdx].value != null ? (
              <circle
                key={series[i].id}
                cx={points[hoverIdx].x}
                cy={points[hoverIdx].y}
                r={4.5}
                className="chart-hover-dot"
                style={{ stroke: series[i].color }}
              />
            ) : null
          )}
      </svg>

      {hoverIdx != null && (
        <div className="chart-tooltip" style={{ left: `${(hoverX / WIDTH) * 100}%` }}>
          <div className="chart-tooltip-time">{formatTimestampShort(base[hoverIdx].t, locale)}</div>
          {single ? (
            <div className="chart-tooltip-value">{formatValue(product, data[0][hoverIdx].value, t)}</div>
          ) : (
            series.map((s, i) => (
              <div className="chart-tooltip-row" key={s.id}>
                <span className="chart-swatch" style={{ background: s.color }} />
                <span className="chart-tooltip-letter">{s.letter}</span>
                <span className="chart-tooltip-value">{formatValue(product, data[i][hoverIdx].value, t)}</span>
              </div>
            ))
          )}
        </div>
      )}

      {onPickTime && <p className="chart-hint">{t("chart.clickHint")}</p>}
    </div>
  );
}
