import { useEffect, useRef, useState } from "react";
import { LayersIcon } from "./icons";
import { BASEMAPS, BASEMAP_ORDER, basemapThumbUrl } from "../data/basemaps";
import { useI18n } from "../i18n";

// Przycisk pod kontrolka zoomu Leafleta rozwijajacy wybor podkladu mapy
// (miniatury) i przelacznik siatki wspolrzednych. Dla "bez mapy" siatka jest
// zawsze wlaczona - inaczej zostalaby sama nakladka bez zadnego odniesienia.
export default function BasemapControl({ basemap, onChange, graticule, onToggleGraticule }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const graticuleForced = basemap === "none";

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e) {
      if (!rootRef.current?.contains(e.target)) setOpen(false);
    }
    function onKey(e) {
      if (e.key !== "Escape") return;
      e.preventDefault(); // Esc zamyka tylko ten panel - nie odznacza boi/punktu (patrz App)
      setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    // faza capture na document: odpala sie przed nasluchem w App (window, bubble)
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  return (
    <div className="basemap-control" ref={rootRef}>
      <button
        className={`basemap-toggle${open ? " is-open" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={t("basemap.title")}
        title={t("basemap.title")}
      >
        <LayersIcon />
      </button>

      {open && (
        <div className="basemap-popover" role="dialog" aria-label={t("basemap.title")}>
          <div className="basemap-popover-title">{t("basemap.title")}</div>
          <div className="basemap-options">
            {BASEMAP_ORDER.map((key) => {
              const thumb = basemapThumbUrl(key);
              return (
                <button
                  key={key}
                  className={`basemap-option${basemap === key ? " is-active" : ""}`}
                  onClick={() => onChange(key)}
                  aria-pressed={basemap === key}
                >
                  <span className={`basemap-thumb${thumb ? "" : " is-grid"}`}>
                    {thumb && (
                      <img
                        src={thumb}
                        alt=""
                        loading="lazy"
                        className={BASEMAPS[key].className ?? ""}
                      />
                    )}
                  </span>
                  <span className="basemap-option-label">{t(`basemap.${key}`)}</span>
                </button>
              );
            })}
          </div>

          <div className="switch-row basemap-graticule-row">
            <span className="switch-label">{t("basemap.graticule")}</span>
            <button
              className={`switch${graticule || graticuleForced ? " is-on" : ""}`}
              role="switch"
              aria-checked={graticule || graticuleForced}
              disabled={graticuleForced}
              onClick={onToggleGraticule}
            >
              <span className="switch-thumb" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
