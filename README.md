# Bentos: SatBałtyk — dashboard dla Trójmiasta

🔗 **Live:** https://embeddedsystems-do.github.io/bentos-satbaltyk-dashboard/

Prosty dashboard webowy (React + Vite + Leaflet) do wizualizacji
danych z eksportu [SatBałtyk](https://satbaltyk.pl) dla całego Bałtyku, ze
szczególnym uwzględnieniem Zatoki Gdańskiej / Trójmiasta. Identyfikacja wizualna (kolory, fonty) nawiązuje do
[bentos.info](https://bentos.info) — projektu monitoringu jakości wody w
Zatoce Gdańskiej, w ramach którego powstaje ten dashboard.

## Jak to działa

Dane wejściowe (GeoTIFF, cała siatka Bałtyku 1280×1408 px / 1 km, projekcja
LAEA SatBałtyk) nie nadają się do bezpośredniego wrzucenia do przeglądarki:
są duże (>1 GB na eksport) i w innej projekcji niż mapa. Dlatego jest tu krok
przetwarzania:

```
dane/<cokolwiek>/snapshots/<produkt>/*.tiff   ← tu wrzucasz nowe eksporty z SatBałtyk
        │
        ▼
scripts/process_data.py   (Python + numpy; GDAL tylko do odczytu GeoTIFF)
        │
        │  1. skanuje dane/ i wykrywa, co jest nowe / nieznane / uszkodzone
        │  2. czyta cały raster LAEA i sam go próbkuje na siatkę zgodną z Web
        │     Mercatorem (bbox Bałtyku w konfiguracji) - bez gdal.Warp do
        │     EPSG:4326, bo wtedy nakładka przesuwała się względem lądu
        │  3. maskuje NoData (w plikach źródłowych to -999, nieotagowane w metadanych)
        │     oraz wartości fizycznie niemożliwe ("valid" w PRODUCTS)
        │  4. koloruje wg stałej skali fizycznej (perceptualnie jednorodne
        │     kolormapy: plasma/viridis/cividis/twilight — bez "tęczy");
        │     wartości poza skalą dostają kolor skrajny, nie znikają
        ▼
public/data/<produkt>/<znacznik_czasu>.png    — nakładka na mapę
public/data/<produkt>/<znacznik_czasu>.grid   — siatka wartości (odczyt pod kursorem, punkty, wykresy)
public/data/manifest.json                     — katalog wszystkich dostępnych warstw/czasów
        │
        ▼
   React + Vite + Leaflet (src/)  ← czyta wyłącznie public/data/*, nic więcej
                                     (co ~20s sam sprawdza, czy manifest się zmienił)
```

### Rozdzielczość i format siatki

Siatka wyjściowa ma kwadratowe piksele w Mercatorze i `GRID_WIDTH` kolumn
(obecnie 720, czyli ok. 2 km na szerokości Trójmiasta; źródło ma 1 km).
Wysokość wynika z obszaru. Podniesienie `GRID_WIDTH` w `process_data.py`
wyostrza mapę, ale rozmiar danych rośnie mniej więcej z jego kwadratem
(1000 kolumn to ok. 2× więcej, 1500 ok. 4× więcej).

Plik `.grid` to wartości zakwantyzowane do kroku z `PRODUCTS` (`step`, np.
0.01), zapisane jako różnice względem sąsiada w wierszu i skompresowane zlib;
przeglądarka rozpakowuje je przez `DecompressionStream`. Ma to ok. 10× mniej
niż surowy float32 - tyle, że wykres punktu ładuje wszystkie klatki naraz.
Format opisuje komentarz nad `write_grid` w skrypcie.

Każda warstwa ma w manifeście własne wymiary siatki (`products.<klucz>.grid`).
Fala (`swh`) i kierunek fali (`mwdir`) są na razie w starszej, rzadszej siatce
360×216 (nie mamy ich źródeł w `dane/`); po ich dorzuceniu skrypt przetworzy je
w nowej rozdzielczości.

Frontend nigdy nie dotyka oryginalnych GeoTIFF-ów — tylko wygenerowanych
plików w `public/data/`.

## Wdrożenie

Każdy push na `main` (`.github/workflows/deploy.yml`) buduje frontend
(`npm run build`) i publikuje go na GitHub Pages. **`public/data/` jest
commitowane do repo** (to jedyne dane, jakich potrzebuje strona — surowe
GeoTIFF-y z `dane/` zostają tylko lokalnie, są w `.gitignore`, ważą za dużo
i nie są do niczego potrzebne po wygenerowaniu warstw). Żeby zaktualizować
dane na żywej stronie: `npm run process-data` lokalnie, `git add public/data`,
commit, push — reszta dzieje się sama.

## Uruchomienie

```bash
npm install                    # raz
npm run process-data           # generuje public/data/ z dane/ (wymaga python3-gdal, matplotlib, pillow, numpy)
npm run dev                    # http://localhost:5173
```

## Dokładanie nowych danych

Wrzuć folder eksportu z SatBałtyk (dokładnie taki, jaki eksportuje strona —
`exportYYYYMMDD_HHMMSS/snapshots/<produkt>/*.tiff`, nazwa folderu dowolna) do
`dane/`, np.:

```
dane/
  export20260925_062942/   (już jest)
  export20261010_120000/   (nowy eksport — po prostu wklejony folder)
```

Dalej masz dwie opcje:

- **Jednorazowo:** `npm run process-data` — doda tylko to, czego jeszcze nie
  ma w `public/data/` (pliki już przetworzone są pomijane), i wypisze co
  znalazł.
- **Na bieżąco:** `npm run process-data:watch` — zostaje w tle, pilnuje
  `dane/` i przetwarza nowe pliki w chwilę po ich wrzuceniu, bez ręcznego
  odpalania. Dashboard sam dopyta o nowy manifest (odświeża go co ~20s), więc
  nowa warstwa pojawi się w przeglądarce bez przeładowania strony.

Skrypt **raportuje, a nie tylko cicho pomija**:

- nierozpoznany folder produktu pod `snapshots/` (np. dorzucisz `gpp` albo
  `rsds`, których jeszcze nie ma w konfiguracji) → ostrzeżenie z podpowiedzią,
  żeby dodać wpis do `PRODUCTS` w `scripts/process_data.py`;
- uszkodzony / nieczytelny plik `.tiff` → ostrzeżenie, plik pomijany, reszta
  przetwarza się dalej.

## Dostępne warstwy

| Produkt | Źródło SatBałtyk | Zakres skali | Uwagi |
|---|---|---|---|
| SST | `x_ss_sst_merge` | 2–22 °C | temperatura powierzchni morza |
| Chlorofil a | `x_ss_modis_ecosat_v2` | 0–8 mg/m³ | przy zakwicie bywa wyżej - takie wartości mają kolor skrajny (legenda: „8+”), a odczyt pod kursorem pokazuje prawdziwą liczbę |
| Tlen rozpuszczony | `m_ug_ecosat_3nm_um_assim_sst_v0` | 6–13 mg/l | model; metadane eksportu podają „mg m-3”, ale wartości (8–12) to mg/l |
| Wysokość fali (SWH) | `m_io_WP_BaltWave2sb` | 0–2.5 m | model falowania; starsza, rzadsza siatka, wartości >2.5 m zostały wcześniej odcięte |
| Kierunek fali (mwdir) | `m_io_WP_BaltWave2sb` | 0–360° | patrz uwaga niżej; starsza, rzadsza siatka |

Zakres skali to tylko zakres kolorów. Dane odrzuca dopiero granica fizyczna
(`valid` w `PRODUCTS`, np. chlorofil powyżej 300 mg/m³ to błąd, nie zakwit).

**Uwaga o kierunku fali:** w plikach źródłowych `mwdir` jest zakodowany w
konwencji -180°..180°, a nie kompasowej 0°..360° — skrypt przelicza to
automatycznie (`(deg + 360) % 360`). Ponadto kierunek bywa zamaskowany
(NoData) tam, gdzie wysokość fali jest bliska zeru — to najpewniej celowe
zachowanie modelu (kierunek fali jest niezdefiniowany przy braku fali), nie
błąd przetwarzania.

Żeby dodać kolejny produkt (np. gpp, rsds): wrzuć jego pliki do
`dane/<eksport>/snapshots/<produkt>/`, uruchom raz `npm run process-data` —
skrypt zgłosi go jako nieznany — i dopisz wpis w `PRODUCTS` w
`scripts/process_data.py` (etykieta, jednostka, zakres skali, kolormapa).

## Identyfikacja wizualna

Paleta i fonty są ściągnięte wprost z arkusza CSS bentos.info (nie z oka):
tło `#00051f`/`#0f1c51` (głęboki granat), akcent `#aaff00` (limonka),
`Open Sauce Sans` na tekst, `Space Mono` na etykiety/dane liczbowe. Domyślna
mapa bazowa to standardowe kafle OSM przyciemnione filtrem CSS (`basemap-inverted`
w `App.css`) — bez zależności od płatnych/kluczowanych usług kafli. Podkład
można przełączyć w aplikacji (`src/data/basemaps.js`). Nakładka z danymi jest
w osobnej warstwie Leaflet, więc filtr jej nie dotyka.

## Czego brakuje / do ustalenia

- Eksport nie zawiera produktów **gpp** (`c_ap_desambem`) ani **rsds**
  (`m_ug_solrad_mtg`), mimo że były w oryginalnym żądaniu eksportu — jest za
  to `mwdir`, o który nie proszono (patrz sekcja wyżej, jak je dodać).
- Format **Macierz SatBałtyk** nie był dostępny w projekcie w momencie
  budowy tego dashboardu — cały pipeline działa na GeoTIFF. Gdyby macierz
  się pojawiła, warto ją porównać z GeoTIFF (m.in. czy niesie własną
  georeferencję, czy trzeba dorobić osobny parser siatki).

## Struktura projektu

```
dane/                       dane źródłowe z SatBałtyk (bez zmian, tylko odczyt)
scripts/process_data.py     pipeline przetwarzania + wykrywanie nowych/nieznanych danych (GDAL + matplotlib)
public/data/                 wygenerowane warstwy (PNG + grid + manifest.json)
src/                          aplikacja React
  App.jsx                     stan główny, dobór warstwy/czasu, odczyt wartości, odpytywanie manifestu
  components/MapView.jsx      mapa Leaflet + nakładka + przyciemnione kafle OSM
  components/Sidebar.jsx      wybór produktu (ikony + liczba dostępnych zdjęć)
  components/icons.jsx        minimalne ikony SVG dla produktów
  components/TimeControl.jsx  suwak czasu + odtwarzanie
  components/Legend.jsx       pasek skali kolorów
  components/CompareSwipe.jsx porównanie dwóch warstw suwakiem
  components/ChartModal.jsx   wykresy punktów w czasie (oraz BuoyModal.jsx dla boi)
  utils/grid.js                odczyt i dekodowanie siatki .grid, formatowanie czasu/kompasu
```

## Licencja

Kod tego repozytorium jest na licencji [MIT](LICENSE). Nie obejmuje to logo
Bentos (`public/brand/bentos-logo.png`, własność projektu bentos.info) ani
danych pochodnych z SatBałtyk (`public/data/`, podlegają warunkom
satbaltyk.pl) — szczegóły w pliku LICENSE.
