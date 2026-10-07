// Prosty, deterministyczny generator liczb pseudolosowych (mulberry32) -
// zeby symulowane odczyty boi byly stabilne dla danego (boja, znacznik czasu)
// zamiast migotac losowo przy kazdym renderze, ale i tak zmienialy sie
// w czasie tak jak prawdziwy sensor by sie zmienial.
function hashSeed(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return h;
}

function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededRandom(seedStr) {
  const rng = mulberry32(hashSeed(seedStr));
  return (min, max) => min + rng() * (max - min);
}

// Gladka, ciagla w czasie "fala" zbudowana z dwoch nalozonych sinusoid o
// deterministycznych (ale losowych na boje+parametr) fazach. Dzieki temu
// odczyt w sasiednich klatkach czasu jest bliski poprzedniemu (pelznie od
// 5.0 do 5.1, 5.2... do celu), zamiast skakac do nowej losowej wartosci przy
// kazdym kroku - tak jak zachowywalby sie prawdziwy powoli zmienny sensor.
function smoothWave(seed, hours, { baseline, amplitude, period }) {
  const rand = seededRandom(seed);
  const phase1 = rand(0, 1);
  const phase2 = rand(0, 1);
  const period2 = period * 0.37;
  const shape =
    0.65 * Math.sin(2 * Math.PI * (hours / period + phase1)) +
    0.35 * Math.sin(2 * Math.PI * (hours / period2 + phase2));
  return baseline + amplitude * shape;
}

// Symulowane odczyty "telemetrii" boi - nie pochodza z rzeczywistego czujnika,
// to demonstracja tego, jakiego rodzaju dane taka boja mogłaby przesyłać.
export function simulateBuoyReading(buoyId, timestampIso) {
  const hours = (timestampIso ? new Date(timestampIso).getTime() : Date.now()) / 3_600_000;

  // Okresy dobrane tak, zeby zmiana miedzy sasiednimi (godzinnymi) klatkami
  // byla rzedu pojedynczych promili pelnego zakresu - realny sensor tez nie
  // przeskakuje o polowe skali w godzine.
  const waterTemp = smoothWave(`${buoyId}::temp`, hours, { baseline: 15, amplitude: 4, period: 300 });
  const waveHeight = Math.max(
    0.05,
    smoothWave(`${buoyId}::wave`, hours, { baseline: 0.55, amplitude: 0.5, period: 150 })
  );
  const windSpeed = Math.max(1, smoothWave(`${buoyId}::wind`, hours, { baseline: 13, amplitude: 10, period: 300 }));
  const windDirRaw = smoothWave(`${buoyId}::winddir`, hours, { baseline: 180, amplitude: 180, period: 300 });
  const windDir = ((windDirRaw % 360) + 360) % 360;
  const pressure = smoothWave(`${buoyId}::pressure`, hours, { baseline: 1013, amplitude: 13, period: 400 });
  const battery = Math.round(
    Math.min(100, Math.max(35, smoothWave(`${buoyId}::battery`, hours, { baseline: 82, amplitude: 16, period: 500 })))
  );
  const signal = Math.min(
    5,
    Math.max(1, Math.round(smoothWave(`${buoyId}::signal`, hours, { baseline: 3.3, amplitude: 1.6, period: 150 })))
  );

  return { waterTemp, waveHeight, windDir, windSpeed, pressure, battery, signal };
}
