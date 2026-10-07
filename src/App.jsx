import { useEffect, useRef, useState } from "react";
import MapView from "./components/MapView";
import Sidebar, { PRODUCT_ORDER } from "./components/Sidebar";
import SidebarWater from "./components/SidebarWater";
import TimeControl from "./components/TimeControl";
import Legend from "./components/Legend";
import PointsPanel from "./components/PointsPanel";
import ChartModal from "./components/ChartModal";
import BuoyModal from "./components/BuoyModal";
import BasemapControl from "./components/BasemapControl";
import { PRODUCT_ICONS } from "./components/icons";
import { BUOYS, buoyPlace } from "./data/buoys";
import { BASEMAPS } from "./data/basemaps";
import {
  getGrid,
  sampleGrid,
  sampleGridNearby,
  findNearestIndex,
  formatProductValue,
  formatTimestamp,
} from "./utils/grid";
import { LANGUAGES, useI18n } from "./i18n";
import "./App.css";

const PLAY_INTERVAL_MS = 700;
const MANIFEST_POLL_MS = 20000; // odswieza katalog warstw co 20s - nowe dane wrzucone do dane/ pojawia sie same
const MAX_PINS = 10; // powyzej tego liczba punktow na liscie robi sie nieczytelna - najstarszy odpada

// Manifest trzyma sciezki wzgledne ("data/sst/xxx.png") - trzeba je doklejac
// do BASE_URL (na GitHub Pages to "/nazwa-repo/", lokalnie "/"), zeby dzialaly
// zarowno w dev, jak i po wdrozeniu na subpath.
function resolveManifestUrls(manifest) {
  const base = import.meta.env.BASE_URL;
  const products = Object.fromEntries(
    Object.entries(manifest.products).map(([key, p]) => [
      key,
      {
        ...p,
        legend: base + p.legend,
        timestamps: p.timestamps.map((t) => ({ ...t, png: base + t.png, grid: base + t.grid })),
      },
    ])
  );
  return { ...manifest, products };
}

// Wybor podkladu mapy przezywa przeladowanie strony (jak jezyk interfejsu).
function useStoredState(key, fallback, isValid = () => true) {
  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      const parsed = raw == null ? fallback : JSON.parse(raw);
      return isValid(parsed) ? parsed : fallback;
    } catch {
      return fallback;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // prywatny tryb / zablokowany storage - wybor po prostu nie przetrwa przeladowania
    }
  }, [key, value]);
  return [value, setValue];
}

function makePinId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

function nearestEntryByTime(entries, targetIso) {
  if (!entries?.length) return null;
  if (!targetIso) return entries[entries.length - 1];
  return entries[findNearestIndex(entries, targetIso)];
}

function buildPublicSignals(manifest, currentIso, location, signalGrids, t) {
  function valueFor(productKey) {
    const entry = nearestEntryByTime(manifest.products[productKey]?.timestamps, currentIso);
    if (location && signalGrids[productKey]) {
      const localValue = sampleGridNearby(
        signalGrids[productKey],
        manifest.bbox,
        location.lat,
        location.lon
      );
      if (Number.isFinite(localValue)) return localValue;
    }
    return entry?.stats?.mean ?? null;
  }

  const sst = valueFor("sst");
  const chla = valueFor("chla");
  const swh = valueFor("swh");

  const cyanobacteriaRisk = chla == null ? 0.34 : clamp01((chla - 0.8) / 3.2);
  const waveRisk = swh == null ? 0.25 : clamp01((swh - 0.4) / 1.4);
  const tempComfort = sst == null ? 0.45 : clamp01((sst - 12) / 8);
  const bathingScore = clamp01(0.78 - cyanobacteriaRisk * 0.38 - waveRisk * 0.28 + tempComfort * 0.12);

  return [
    {
      label: t("signal.bathing"),
      value: t(bathingScore > 0.66 ? "signal.good" : bathingScore > 0.42 ? "signal.caution" : "signal.discouraged"),
      tone: bathingScore > 0.66 ? "good" : bathingScore > 0.42 ? "warn" : "bad",
    },
    {
      label: t("signal.cyanobacteria"),
      value: t(cyanobacteriaRisk < 0.35 ? "signal.low" : cyanobacteriaRisk < 0.68 ? "signal.medium" : "signal.high"),
      tone: cyanobacteriaRisk < 0.35 ? "good" : cyanobacteriaRisk < 0.68 ? "warn" : "bad",
    },
    {
      label: t("signal.comfort"),
      value: t(tempComfort > 0.62 && waveRisk < 0.55 ? "signal.comfortHigh" : tempComfort > 0.38 ? "signal.moderate" : "signal.cold"),
      tone: tempComfort > 0.62 && waveRisk < 0.55 ? "good" : "warn",
    },
  ];
}

// Czy panel boczny nakłada się na mapę (desktop) - na telefonie to szuflada
// na cały ekran i mapa nie potrzebuje odsunięcia (patrz .sidebar w App.css).
function useSidebarOverlaysMap() {
  const query = "(min-width: 721px)";
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return matches;
}

const SIDEBAR_WIDTH_PX = 340; // jak --sidebar-width w App.css

export default function App() {
  const { language, setLanguage, locale, t } = useI18n();
  const sidebarOverlaysMap = useSidebarOverlaysMap();
  const [manifest, setManifest] = useState(null);
  const [error, setError] = useState(null);
  const [product, setProduct] = useState("sst");
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1); // mnoznik tempa animacji (0.5x-4x), patrz TimeControl
  const [gridData, setGridData] = useState(null);
  const [hoverLatLng, setHoverLatLng] = useState(null); // { lat, lon, side } | null - pozycja kursora i strona suwaka porownania
  const [pins, setPins] = useState([]); // [{ id, lat, lon }]
  const [pinMode, setPinMode] = useState(false); // czy klik na mapie dodaje punkt (jawnie wlaczane przyciskiem)
  const [chartPinId, setChartPinId] = useState(null); // ktory punkt ma otwarty wykres w czasie
  // Na telefonie startujemy z ukrytym panelem (mapa na caly ekran) - na
  // desktopie/tablecie panel jest domyslnie widoczny.
  const [sidebarOpen, setSidebarOpen] = useState(() =>
    typeof window === "undefined" ? true : window.innerWidth > 720
  );
  const [buoysVisible, setBuoysVisible] = useState(true);
  const [openBuoyId, setOpenBuoyId] = useState(null);
  const [selectedBuoyId, setSelectedBuoyId] = useState(null);
  const [selectedPinId, setSelectedPinId] = useState(null);
  const [signalGrids, setSignalGrids] = useState({});
  // id boi/punktu, dla ktorego zamknieto ocene - wraca przy wyborze innego
  // miejsca albo po odznaczeniu (klik w pusta mape).
  const [signalsDismissedFor, setSignalsDismissedFor] = useState(null);
  const [signalsInfoOpen, setSignalsInfoOpen] = useState(false); // objasnienie, co znacza poziomy oceny
  const [basemap, setBasemap] = useStoredState("bentos-basemap", "dark", (v) => v in BASEMAPS);
  const [graticule, setGraticule] = useStoredState("bentos-graticule", false, (v) => typeof v === "boolean");

  // Porownanie warstw: druga warstwa po prawej stronie suwaka na mapie, w
  // klatce najblizszej w czasie do aktualnej klatki glownej warstwy.
  const [compareOn, setCompareOn] = useState(false);
  const [compareKey, setCompareKey] = useState("chla");
  const [compareGrid, setCompareGrid] = useState(null);

  const entries = manifest?.products[product]?.timestamps ?? [];
  const currentEntry = entries[index];
  const compareEntry =
    compareOn && manifest ? nearestEntryByTime(manifest.products[compareKey]?.timestamps, currentEntry?.t) : null;

  // Polling zyje przez caly czas zycia komponentu, wiec aktualny widok czyta
  // z refa - inaczej widzialby wartosci z pierwszego renderu.
  const viewRef = useRef({});
  viewRef.current = { product, t: currentEntry?.t, generatedAt: manifest?.generated_at };

  useEffect(() => {
    let cancelled = false;

    function loadManifest(isFirstLoad) {
      fetch(`${import.meta.env.BASE_URL}data/manifest.json?t=${Date.now()}`)
        .then((r) => {
          if (!r.ok) throw new Error(`manifest.json: HTTP ${r.status}`);
          return r.json();
        })
        .then((raw) => {
          const view = viewRef.current;
          if (cancelled || raw.generated_at === view.generatedAt) return;
          // nowe dane w tle - zostajemy przy tym samym produkcie/momencie w czasie
          // (przy pierwszym ladowaniu t == null, wiec wybierana jest najnowsza klatka)
          const m = resolveManifestUrls(raw);
          const nextEntries = m.products[view.product]?.timestamps ?? [];
          setManifest(m);
          setIndex(Math.max(0, findNearestIndex(nextEntries, view.t)));
        })
        .catch((e) => {
          // nieudany polling w tle nie powinien zabijac dzialajacego widoku
          if (isFirstLoad && !cancelled) setError(e.message);
        });
    }

    loadManifest(true);
    const id = setInterval(() => loadManifest(false), MANIFEST_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // Ocena warunkow korzysta jednoczesnie z SST, chlorofilu i wysokosci fali,
  // niezaleznie od warstwy wybranej aktualnie w panelu bocznym.
  useEffect(() => {
    if (!manifest) return;
    let cancelled = false;
    const sources = ["sst", "chla", "swh"]
      .map((key) => [key, nearestEntryByTime(manifest.products[key]?.timestamps, currentEntry?.t)?.grid])
      .filter(([, url]) => url);

    Promise.all(
      sources.map(([key, url]) =>
        getGrid(url)
          .then((grid) => [key, grid])
          .catch(() => null)
      )
    ).then((loaded) => {
      if (!cancelled) setSignalGrids(Object.fromEntries(loaded.filter(Boolean)));
    });
    return () => {
      cancelled = true;
    };
  }, [manifest, currentEntry?.t]);

  // Ladowanie siatki wartosci dla aktualnej warstwy (do odczytu pod kursorem i w punktach)
  useEffect(() => {
    if (!currentEntry) return;
    let cancelled = false;
    getGrid(currentEntry.grid)
      .then((arr) => {
        if (!cancelled) setGridData(arr);
      })
      .catch(() => {
        if (!cancelled) setGridData(null);
      });
    return () => {
      cancelled = true;
    };
  }, [currentEntry]);

  useEffect(() => {
    if (!compareEntry) {
      setCompareGrid(null);
      return;
    }
    let cancelled = false;
    getGrid(compareEntry.grid)
      .then((arr) => {
        if (!cancelled) setCompareGrid(arr);
      })
      .catch(() => {
        if (!cancelled) setCompareGrid(null);
      });
    return () => {
      cancelled = true;
    };
  }, [compareEntry?.grid]);

  // Podglad nastepnej klatki w tle - animacja gra plynnie bez czekania na fetch
  useEffect(() => {
    if (!entries.length) return;
    const next = entries[(index + 1) % entries.length];
    if (next) getGrid(next.grid).catch(() => {});
  }, [entries, index]);

  // Animacja odtwarzania - predkosc ustawiana przez uzytkownika (patrz TimeControl)
  useEffect(() => {
    if (!playing || entries.length < 2) return;
    const id = setInterval(() => {
      setIndex((i) => (i + 1) % entries.length);
    }, PLAY_INTERVAL_MS / speed);
    return () => clearInterval(id);
  }, [playing, entries.length, speed]);

  // Esc dziala jak klik w pusta mape: zdejmuje zaznaczenie boi/punktu (i ocene
  // warunkow). Otwarty wykres punktu sam zamyka sie na Esc - wtedy zaznaczenie
  // zostaje; Esc zamykajacy wybor podkladu mapy (defaultPrevented) tez go nie rusza.
  useEffect(() => {
    function onKey(e) {
      if (e.key !== "Escape" || e.defaultPrevented || chartPinId) return;
      // kliknięty znacznik trzyma fokus, a po wcisnieciu klawisza przegladarka
      // pokazalaby na nim obwodke - odznaczony punkt nie powinien wygladac na wybrany
      const active = document.activeElement;
      if (active?.closest?.(".leaflet-marker-icon")) active.blur();
      setSelectedPinId(null);
      setSelectedBuoyId(null);
      setOpenBuoyId(null);
      setSignalsDismissedFor(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [chartPinId]);

  function handleSelectProduct(nextProduct) {
    setPlaying(false);
    const nextEntries = manifest.products[nextProduct].timestamps;
    const nearest = findNearestIndex(nextEntries, currentEntry?.t);
    // ta sama warstwa po obu stronach suwaka nic nie pokazuje - zamieniamy strony
    if (nextProduct === compareKey) setCompareKey(product);
    setProduct(nextProduct);
    setIndex(nearest);
  }

  function handleHover(lat, lon, side = "left") {
    setHoverLatLng(lat == null ? null : { lat, lon, side });
  }

  function toggleCompare() {
    if (!compareOn && compareKey === product) {
      setCompareKey(PRODUCT_ORDER.find((key) => key !== product && manifest.products[key]));
    }
    setCompareOn((v) => !v);
  }

  // Klik w wykres (punktu albo boi) przestawia mape na wskazany moment.
  function jumpToTime(iso) {
    setPlaying(false);
    setIndex(findNearestIndex(entries, iso));
  }

  function clearSelection() {
    setSelectedPinId(null);
    setSelectedBuoyId(null);
    setOpenBuoyId(null);
  }

  function selectPin(id) {
    clearSelection();
    setSelectedPinId(id);
    setSignalsDismissedFor((cur) => (cur === id ? cur : null));
  }

  function selectBuoy(id) {
    clearSelection();
    setSelectedBuoyId(id);
    setSignalsDismissedFor((cur) => (cur === id ? cur : null));
    setOpenBuoyId(id);
  }

  function handleAddPin(lat, lon) {
    const id = makePinId();
    setPins((prev) => {
      const next = [...prev, { id, lat, lon }];
      return next.length > MAX_PINS ? next.slice(next.length - MAX_PINS) : next;
    });
    selectPin(id);
  }

  // Klik w puste miejsce mapy: w trybie dodawania stawia punkt, poza nim
  // "wychodzi" z zaznaczenia - bez boi/punktu nie ma tez oceny warunkow.
  function handleMapClick(lat, lon) {
    if (pinMode) {
      handleAddPin(lat, lon);
    } else {
      clearSelection();
      setSignalsDismissedFor(null);
    }
  }

  // W trybie dodawania klik w istniejacy punkt go usuwa (stawianie i
  // poprawianie w jednym miejscu, bez siegania do panelu bocznego). Poza nim
  // pierwszy klik zaznacza punkt (ocena warunkow), drugi klik w zaznaczony
  // punkt otwiera jego wykres.
  function handlePinClick(id) {
    if (pinMode) {
      handleRemovePin(id);
    } else if (selectedPinId === id) {
      setChartPinId(id);
    } else {
      selectPin(id);
    }
  }

  function handleRemovePin(id) {
    setPins((prev) => prev.filter((p) => p.id !== id));
    setChartPinId((cur) => (cur === id ? null : cur));
    setSelectedPinId((cur) => (cur === id ? null : cur));
  }

  if (error) {
    return (
      <div className="state-message">
        {t("app.loadError", { error })}{" "}
        <code>npm run process-data</code>.
      </div>
    );
  }
  if (!manifest) {
    return <div className="state-message">{t("app.loading")}</div>;
  }

  const activeProduct = { ...manifest.products[product], label: t(`product.${product}`) };
  const compareProduct = compareOn ? manifest.products[compareKey] : null;
  const hoverOnCompare = compareProduct && hoverLatLng?.side === "right";
  const hoverGrid = hoverOnCompare ? compareGrid : gridData;
  const hoverValue =
    hoverLatLng && hoverGrid ? sampleGrid(hoverGrid, manifest.bbox, hoverLatLng.lat, hoverLatLng.lon) : null;
  const hoverLabel = hoverLatLng
    ? (formatProductValue(hoverOnCompare ? compareProduct : activeProduct, hoverValue) ?? t("common.noData"))
    : null;
  const pointsWithValues = pins.map((p) => {
    const value = gridData ? sampleGrid(gridData, manifest.bbox, p.lat, p.lon) : null;
    return { ...p, label: formatProductValue(activeProduct, value) };
  });
  const selectedPinIndex = pins.findIndex((p) => p.id === selectedPinId);
  const selectedPin = selectedPinIndex >= 0 ? pins[selectedPinIndex] : null;
  const selectedBuoy = BUOYS.find((b) => b.id === selectedBuoyId) ?? null;
  const signalLocation = selectedBuoy ?? selectedPin;
  const signalScope = selectedBuoy
    ? t("signal.scopeBuoy", { name: selectedBuoy.name, place: buoyPlace(selectedBuoy, language) })
    : selectedPin
      ? t("signal.scopePoint", { letter: "ABCDEFGHIJ"[selectedPinIndex] ?? "?", lat: selectedPin.lat.toFixed(3), lon: selectedPin.lon.toFixed(3) })
      : null;
  const signalsVisible = Boolean(signalLocation) && signalsDismissedFor !== signalLocation.id;
  const publicSignals = signalsVisible
    ? buildPublicSignals(manifest, currentEntry?.t, signalLocation, signalGrids, t)
    : [];

  return (
    <div className={`layout${sidebarOpen ? "" : " sidebar-collapsed"}${signalsVisible ? "" : " signals-hidden"}`}>
      <aside className={`sidebar${sidebarOpen ? "" : " is-collapsed"}`}>
        <SidebarWater
          active={sidebarOpen}
          simTime={playing && currentEntry ? new Date(currentEntry.t).getTime() : null}
        />
        <Sidebar products={manifest.products} activeProduct={product} onSelect={handleSelectProduct} />

        <section className="panel">
          <h2>{activeProduct.label}</h2>
          <Legend product={activeProduct} />
          <TimeControl
            timestamps={entries}
            index={index}
            onChange={(i) => {
              setPlaying(false);
              setIndex(i);
            }}
            playing={playing}
            onTogglePlay={() => setPlaying((p) => !p)}
            speed={speed}
            onSpeedChange={setSpeed}
          />
        </section>

        <section className="panel buoys-toggle-panel map-toggles-panel">
          <div className="switch-row">
            <span className="switch-label">
              {t("sidebar.buoys")}
              <span className="buoy-sim-tag">{t("common.simulation")}</span>
            </span>
            <button
              className={`switch${buoysVisible ? " is-on" : ""}`}
              role="switch"
              aria-checked={buoysVisible}
              onClick={() => {
                // chowamy boje - zamykamy tez ewentualny otwarty panel
                if (buoysVisible) {
                  setOpenBuoyId(null);
                  setSelectedBuoyId(null);
                }
                setBuoysVisible(!buoysVisible);
              }}
            >
              <span className="switch-thumb" />
            </button>
          </div>
          <div className="switch-row compare-switch-row">
            <span className="switch-label" title={t("compare.hint")}>
              {t("compare.title")}
            </span>
            <button
              className={`switch${compareOn ? " is-on" : ""}`}
              role="switch"
              aria-checked={compareOn}
              onClick={toggleCompare}
            >
              <span className="switch-thumb" />
            </button>
          </div>
          {compareOn && compareProduct && (
            <div className="compare-body">
              <div className="compare-label">{t("compare.rightLayer")}</div>
              <div className="compare-chips" role="group" aria-label={t("compare.rightLayer")}>
                {PRODUCT_ORDER.filter((key) => key !== product && manifest.products[key]).map((key) => {
                  const Icon = PRODUCT_ICONS[key];
                  return (
                    <button
                      key={key}
                      className={`buoy-chart-tab compare-chip${compareKey === key ? " is-active" : ""}`}
                      onClick={() => setCompareKey(key)}
                      aria-pressed={compareKey === key}
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
              <Legend product={compareProduct} />
              {compareEntry && (
                <div className="compare-frame">
                  {t("compare.frame", { time: formatTimestamp(compareEntry.t, locale) })}
                </div>
              )}
            </div>
          )}
        </section>

        <PointsPanel
          points={pointsWithValues}
          selectedPointId={selectedPinId}
          pinMode={pinMode}
          onTogglePinMode={() => setPinMode((v) => !v)}
          onRemove={handleRemovePin}
          onClear={() => {
            setPins([]);
            setChartPinId(null);
            setSelectedPinId(null);
          }}
          onSelect={selectPin}
          onShowChart={(id) => {
            selectPin(id);
            setChartPinId(id);
          }}
        />

        <footer className="sidebar-footer">
          {t("footer.data", { date: new Date(manifest.generated_at).toLocaleString(locale) })}
          <br />
          {t("footer.projectBefore")}{" "}
          <a href="https://bentos.info" target="_blank" rel="noreferrer">
            Bentos
          </a>{" "}
          {t("footer.projectAfter")}
          <div className="sidebar-footer-legal">© 2026 BENTOS · EmbeddedSystems.do × IOPAN</div>
        </footer>
      </aside>

      <button
        className="sidebar-toggle"
        onClick={() => setSidebarOpen((v) => !v)}
        aria-label={t(sidebarOpen ? "sidebar.hide" : "sidebar.show")}
      >
        <span className="sidebar-toggle-chevron">{sidebarOpen ? "‹" : "›"}</span>
        <span className="sidebar-toggle-label">{sidebarOpen ? t("common.close") : `☰ ${t("sidebar.layersButton")}`}</span>
      </button>

      <main className="map-wrap">
        <div className="brand-badge">
          <div className="brand-badge-id">
            <img src={`${import.meta.env.BASE_URL}brand/bentos-logo.png`} alt="Bentos" className="brand-badge-logo" />
            <span className="brand-badge-location">{t("brand.location")}</span>
          </div>
          <div className={`language-switch is-${language}`} role="group" aria-label={t("language.label")}>
            <span className="language-switch-thumb" aria-hidden="true" />
            {LANGUAGES.map((lang) => (
              <button
                key={lang}
                className={language === lang ? "is-active" : ""}
                onClick={() => setLanguage(lang)}
                aria-pressed={language === lang}
              >
                {lang.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        {/* Ocena pojawia sie tylko dla wybranej boi/punktu i zostaje tez przy
            otwartym panelu boi (key na zakresie odpala krotkie podswietlenie,
            zeby bylo widac, ze sie przeliczyla). */}
        {signalsVisible && (
          <div className="public-signals" aria-label={t("signal.aria")}>
            <div className="public-signals-head">
              <span>{t("signal.title")}</span>
              <div className="public-signals-head-actions">
                <strong>{t("signal.demo")}</strong>
                <button
                  className={`public-signals-info${signalsInfoOpen ? " is-open" : ""}`}
                  onClick={() => setSignalsInfoOpen((v) => !v)}
                  aria-expanded={signalsInfoOpen}
                  aria-label={t("signal.info")}
                  title={t("signal.info")}
                >
                  i
                </button>
                <button
                  className="public-signals-close"
                  onClick={() => setSignalsDismissedFor(signalLocation.id)}
                  aria-label={t("signal.close")}
                  title={t("signal.close")}
                >
                  ×
                </button>
              </div>
            </div>
            <div className="public-signals-scope" title={signalScope}>{signalScope}</div>
            {selectedPin && <div className="public-signals-hint">{t("signal.chartHint")}</div>}
            <div className="public-signals-grid" key={signalScope}>
              {publicSignals.map((signal) => (
                <div className={`public-signal is-${signal.tone}`} key={signal.label}>
                  <span>{signal.label}</span>
                  <strong>{signal.value}</strong>
                </div>
              ))}
            </div>
            {signalsInfoOpen && (
              <div className="public-signals-explain">
                <p>{t("signal.infoIntro")}</p>
                <dl>
                  <dt>{t("signal.bathing")}</dt>
                  <dd>{t("signal.infoBathing")}</dd>
                  <dt>{t("signal.cyanobacteria")}</dt>
                  <dd>{t("signal.infoCyano")}</dd>
                  <dt>{t("signal.comfort")}</dt>
                  <dd>{t("signal.infoComfort")}</dd>
                </dl>
                <p className="public-signals-explain-note">{t("signal.infoNote")}</p>
              </div>
            )}
          </div>
        )}

        <BasemapControl
          basemap={basemap}
          onChange={setBasemap}
          graticule={graticule}
          onToggleGraticule={() => setGraticule((v) => !v)}
        />

        <div className="alpha-badge">
          <span className="alpha-badge-dot" />
          <span className="alpha-badge-text">
            <strong>ALPHA</strong> — {t("app.alpha")}
          </span>
        </div>

        <MapView
          bbox={manifest.bbox}
          imageUrl={currentEntry?.png}
          productKey={product}
          hoverLabel={hoverLabel}
          pins={pins}
          selectedPinId={selectedPinId}
          pinMode={pinMode}
          buoysVisible={buoysVisible}
          selectedBuoyId={selectedBuoyId}
          basemap={basemap}
          showGraticule={graticule}
          leftInset={sidebarOverlaysMap && sidebarOpen ? SIDEBAR_WIDTH_PX : 0}
          westMargin={sidebarOverlaysMap ? SIDEBAR_WIDTH_PX + 24 : 0}
          compare={compareEntry ? { imageUrl: compareEntry.png, productKey: compareKey } : null}
          onHover={handleHover}
          onPinClick={handlePinClick}
          onMapClick={handleMapClick}
          onBuoyClick={selectBuoy}
        />
      </main>

      {chartPinId && pins.some((p) => p.id === chartPinId) && (
        <ChartModal
          pins={pins}
          pointId={chartPinId}
          products={manifest.products}
          initialProductKey={product}
          bbox={manifest.bbox}
          currentTime={currentEntry?.t}
          onPickTime={jumpToTime}
          onClose={() => setChartPinId(null)}
        />
      )}

      {openBuoyId &&
        (() => {
          const buoy = BUOYS.find((b) => b.id === openBuoyId);
          if (!buoy) return null;
          return (
            <BuoyModal
              buoy={buoy}
              timestampIso={currentEntry?.t}
              entries={entries}
              onPickTime={jumpToTime}
              onClose={() => setOpenBuoyId(null)}
            />
          );
        })()}
    </div>
  );
}
