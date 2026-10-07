import { useMemo, useRef, useState } from "react";
import { findNearestIndex, formatTimestampShort } from "../utils/grid";
import { simulateBuoyReading } from "../utils/simulate";
import { nearestPointIndex } from "../utils/chartAxis";
import ChartTimeAxis from "./ChartTimeAxis";
import { useI18n } from "../i18n";

const WIDTH = 300;
const HEIGHT = 160;
const PAD = { top: 12, right: 12, bottom: 34, left: 38 };
const INNER_W = WIDTH - PAD.left - PAD.right;
const INNER_H = HEIGHT - PAD.top - PAD.bottom;

export const BUOY_CHART_METRICS = {
  waterTemp: { labelKey: "buoy.metric.waterTemp", unit: "°C", digits: 1 },
  waveHeight: { labelKey: "buoy.metric.waveHeight", unit: "m", digits: 2 },
  windSpeed: { labelKey: "buoy.metric.windSpeed", unit: "km/h", digits: 0 },
  pressure: { labelKey: "buoy.metric.pressure", unit: "hPa", digits: 0 },
};

// Bez najechania odczyt pokazuje moment ustawiony na mapie (przerywana linia
// "mapa"); klik w wykres przestawia mape na wskazany moment.
export default function BuoyChart({ buoy, entries, metricKey, currentTime, onPickTime }) {
  const { locale, t } = useI18n();
  const [hoverIdx, setHoverIdx] = useState(null);
  const svgRef = useRef(null);
  const metric = BUOY_CHART_METRICS[metricKey] ?? BUOY_CHART_METRICS.waterTemp;

  const series = useMemo(() => {
    const source = entries.length ? entries : [{ t: new Date().toISOString() }];
    return source.map((entry) => ({
      t: entry.t,
      value: simulateBuoyReading(buoy.id, entry.t)[metricKey],
    }));
  }, [buoy.id, entries, metricKey]);

  const values = series.map((d) => d.value);
  const times = series.map((d) => new Date(d.t).getTime());
  const tMin = times[0];
  const tMax = times[times.length - 1];
  const span = tMax - tMin || 1;
  let vMin = Math.min(...values);
  let vMax = Math.max(...values);
  if (vMin === vMax) {
    vMin -= 1;
    vMax += 1;
  } else {
    const pad = (vMax - vMin) * 0.18;
    vMin -= pad;
    vMax += pad;
  }

  const xFor = (t) => PAD.left + ((t - tMin) / span) * INNER_W;
  const yFor = (v) => PAD.top + INNER_H - ((v - vMin) / (vMax - vMin)) * INNER_H;
  const points = series.map((d, i) => ({ ...d, x: xFor(times[i]), y: yFor(d.value) }));
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
  const area = `${path} L${points[points.length - 1].x},${PAD.top + INNER_H} L${points[0].x},${
    PAD.top + INNER_H
  } Z`;
  const yTicks = Array.from({ length: 3 }, (_, i) => vMin + ((vMax - vMin) * i) / 2);

  function handleMove(evt) {
    setHoverIdx(nearestPointIndex(svgRef.current, evt, points, WIDTH));
  }

  const mapIdx = currentTime ? findNearestIndex(series, currentTime) : points.length - 1;
  const mapX = points[mapIdx].x;
  const hover = points[hoverIdx ?? mapIdx];

  function handleClick(evt) {
    const idx = nearestPointIndex(svgRef.current, evt, points, WIDTH);
    onPickTime?.(series[idx].t);
  }
  const valueLabel = `${hover.value.toFixed(metric.digits)} ${metric.unit}`;

  return (
    <div className="buoy-chart-wrap">
      <div className="buoy-chart-readout">
        <span className="buoy-chart-readout-label">{t("chart.selectedReading")}</span>
        <span className="buoy-chart-readout-time">{formatTimestampShort(hover.t, locale)}</span>
        <strong>{valueLabel}</strong>
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className={`buoy-chart-svg${onPickTime ? " is-pickable" : ""}`}
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverIdx(null)}
        onClick={handleClick}
      >
        {yTicks.map((v, i) => {
          const y = yFor(v);
          return (
            <g key={i}>
              <line x1={PAD.left} x2={WIDTH - PAD.right} y1={y} y2={y} className="chart-gridline" />
              <text x={PAD.left - 6} y={y} className="chart-axis-label" textAnchor="end" dominantBaseline="middle">
                {v.toFixed(metric.digits)}
              </text>
            </g>
          );
        })}
        <ChartTimeAxis
          series={series}
          times={times}
          xFor={xFor}
          y={PAD.top + INNER_H + 14}
          count={4}
          labelWidth={44}
          gap={10}
          locale={locale}
        />
        <g className="chart-map-marker">
          <line x1={mapX} x2={mapX} y1={PAD.top} y2={PAD.top + INNER_H} />
        </g>
        <path d={area} className="chart-area" />
        <path d={path} fill="none" className="chart-line" />
        <line x1={hover.x} x2={hover.x} y1={PAD.top} y2={PAD.top + INNER_H} className="chart-crosshair" />
        <circle cx={hover.x} cy={hover.y} r={4} className="chart-hover-dot" />
      </svg>
      {onPickTime && <p className="chart-hint">{t("chart.clickHint")}</p>}
    </div>
  );
}
