// Wspolne pomocniki osi czasu dla wykresow (punkt na mapie + historia boi).

// Znaczniki osi X rozlozone rownomiernie w CZASIE, nie po indeksie - klatki
// nie sa rozmieszczone rowno (np. SST ma dziury), wiec wybor co n-ty indeks
// potrafil skleic dwie etykiety w jednym miejscu. Skrajne etykiety sa
// wyrownane do krawedzi (patrz ChartTimeAxis), wiec ich srodek lezy pol
// szerokosci etykiety do wewnatrz - tak liczymy odstepy. Pierwsza i ostatnia
// etykieta zostaja zawsze, kolidujace srodkowe odpadaja.
export function pickTimeTicks(times, xFor, { count, labelWidth, gap }) {
  const last = times.length - 1;
  if (last <= 0) return [0];
  const center = (i) => xFor(times[i]) + (i === 0 ? labelWidth / 2 : i === last ? -labelWidth / 2 : 0);
  const fits = (a, b) => center(b) - center(a) >= labelWidth + gap;

  const tMin = times[0];
  const tMax = times[last];
  const picked = [0];
  for (let k = 1; k < count - 1; k++) {
    const idx = nearestTimeIndex(times, tMin + ((tMax - tMin) * k) / (count - 1));
    if (idx !== last && fits(picked[picked.length - 1], idx)) picked.push(idx);
  }
  while (picked.length > 1 && !fits(picked[picked.length - 1], last)) picked.pop();
  if (picked.length > 1 || fits(0, last)) picked.push(last);
  return picked;
}

function nearestTimeIndex(times, target) {
  let best = 0;
  for (let i = 1; i < times.length; i++) {
    if (Math.abs(times[i] - target) < Math.abs(times[best] - target)) best = i;
  }
  return best;
}

// Indeks punktu najblizszego kursorowi w poziomie (wspolrzedne viewBox).
export function nearestPointIndex(svg, evt, points, viewBoxWidth) {
  const rect = svg.getBoundingClientRect();
  const svgX = ((evt.clientX - rect.left) / rect.width) * viewBoxWidth;
  let best = 0;
  points.forEach((p, i) => {
    if (Math.abs(p.x - svgX) < Math.abs(points[best].x - svgX)) best = i;
  });
  return best;
}

// Etykieta osi X w dwoch liniach (data / godzina) - wezsza niz "24 wrz, 20:00"
// w jednej linii, wiec miesci sie wiecej znacznikow bez nachodzenia.
export function axisDateParts(iso, locale) {
  const date = new Date(iso);
  const opts = { timeZone: "Europe/Warsaw" };
  return {
    day: new Intl.DateTimeFormat(locale, { ...opts, day: "numeric", month: "short" }).format(date),
    time: new Intl.DateTimeFormat(locale, { ...opts, hour: "2-digit", minute: "2-digit" }).format(date),
  };
}
