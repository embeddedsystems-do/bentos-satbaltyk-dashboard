import { axisDateParts, pickTimeTicks } from "../utils/chartAxis";

// Etykiety osi X (data nad godzina). Skrajne etykiety sa wyrownane do
// krawedzi wykresu, zeby nie wystawaly poza viewBox.
export default function ChartTimeAxis({ series, times, xFor, y, count, labelWidth, gap, locale }) {
  const ticks = pickTimeTicks(times, xFor, { count, labelWidth, gap });
  return ticks.map((i) => {
    const x = xFor(times[i]);
    const { day, time } = axisDateParts(series[i].t, locale);
    const anchor = i === 0 && times.length > 1 ? "start" : i === times.length - 1 && times.length > 1 ? "end" : "middle";
    return (
      <text key={i} x={x} y={y} className="chart-axis-label" textAnchor={anchor}>
        <tspan x={x}>{day}</tspan>
        <tspan x={x} dy="1.2em">{time}</tspan>
      </text>
    );
  });
}
