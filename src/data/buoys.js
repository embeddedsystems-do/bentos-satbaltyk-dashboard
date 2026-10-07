// Wspolrzedne oparte na rzeczywistych molo (zrodlo: OpenStreetMap/Nominatim),
// z niewielkim przesunieciem w stronę morza od czubka pomostu - tak jak
// realna boja pomiarowa bylaby zakotwiczona tuz za konstrukcja, nie na niej.
// To wciaz demonstracyjne punkty, nie realne boje pomiarowe.
export const BUOYS = [
  {
    id: "gdansk",
    name: "Alicja",
    place: { pl: "Molo w Brzeźnie (Gdańsk)", en: "Brzeźno Pier (Gdańsk)", sv: "Brzeźnopiren (Gdańsk)" },
    lat: 54.4142,
    lon: 18.6255,
  },
  {
    id: "gdynia",
    name: "Bob",
    place: { pl: "Molo w Orłowie (Gdynia)", en: "Orłowo Pier (Gdynia)", sv: "Orłowopiren (Gdynia)" },
    lat: 54.4799,
    lon: 18.5676,
  },
  {
    id: "sopot",
    name: "Charlie",
    place: { pl: "Molo w Sopocie", en: "Sopot Pier", sv: "Sopotpiren" },
    lat: 54.4482,
    lon: 18.5772,
  },
];

export function buoyPlace(buoy, language) {
  return buoy.place[language] ?? buoy.place.pl;
}
