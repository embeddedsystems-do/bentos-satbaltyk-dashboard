#!/usr/bin/env python3
"""
Przetwarza eksporty GeoTIFF z SatBaltyk (satbaltyk.pl) do postaci gotowej
dla dashboardu webowego: przycina do obszaru Morza Baltyckiego,
przeprojektowuje na siatke zgodna z Web Mercatorem (Leaflet), koloruje wg skali fizycznej i zapisuje jako
PNG (do wyswietlenia na mapie) + skompresowana siatka wartosci .grid (do odczytu
wartosci pod kursorem i wykresow) + manifest.json (katalog wszystkich dostepnych warstw).

Wejscie: dane/<dowolna_nazwa>/snapshots/<produkt>/*.tiff
         (np. dane/export20261010_120000/snapshots/sst/...) - wystarczy wrzucic
         nowy folder eksportu z SatBaltyk do dane/, struktura wewnatrz nie
         musi sie zmieniac.
Wyjscie: public/data/<produkt>/<timestamp>.png + .grid + public/data/manifest.json

Uruchomienie:
    python3 scripts/process_data.py            # jednorazowo
    python3 scripts/process_data.py --watch     # pilnuje dane/ i przetwarza na biezaco

Skrypt jest idempotentny/przyrostowy - pomija pliki, ktore juz maja gotowy
PNG+grid w katalogu wyjsciowym, wiec mozna go bezpiecznie odpalac ponownie po
dorzuceniu kolejnego folderu eksportu do dane/. Nierozpoznane produkty
(foldery snapshots/<x> bez wpisu w PRODUCTS) i uszkodzone/nieczytelne pliki
sa raportowane, ale nie przerywaja przetwarzania reszty.
"""
import argparse
import json
import os
import re
import struct
import sys
import time
import zlib
from datetime import datetime, timezone
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

import numpy as np
from PIL import Image

try:
    from osgeo import gdal
except ModuleNotFoundError:
    gdal = None
else:
    gdal.UseExceptions()
    gdal.SetConfigOption("CPL_LOG", "/dev/null")

ROOT = Path(__file__).resolve().parent.parent
os.environ.setdefault("MPLCONFIGDIR", str(ROOT / ".matplotlib-cache"))

import matplotlib as mpl
import matplotlib.colors as mcolors

DANE_DIR = ROOT / "dane"
OUT_DIR = ROOT / "public" / "data"

# Obszar Morza Baltyckiego (lon_min, lat_min, lon_max, lat_max, EPSG:4326).
# Te same granice sa uzywane przez aplikacje jako logiczny obszar nawigacji.
BBOX = (9.0, 53.0, 31.5, 66.5)
# Siatka wyjsciowa ma kwadratowe piksele w Web Mercatorze (tak jak ImageOverlay
# w Leaflet). Zrodlo ma 1 km; 720 kolumn to ok. 2 km na szerokosci Trojmiasta
# (kolumny sa rowne co do dlugosci geograficznej, wiec na polnocy sa gesciej).
# Wiecej = ostrzej, ale proporcjonalnie wiecej danych do pobrania (PNG + .grid
# rosna mniej wiecej z kwadratem GRID_WIDTH).
GRID_WIDTH = 720
GRID_HEIGHT = round(
    GRID_WIDTH
    * (
        np.log(np.tan(np.pi / 4.0 + np.deg2rad(BBOX[3]) / 2.0))
        - np.log(np.tan(np.pi / 4.0 + np.deg2rad(BBOX[1]) / 2.0))
    )
    / np.deg2rad(BBOX[2] - BBOX[0])
)
I32F_WIDTH = 1280
I32F_HEIGHT = 1408
SRC_X_MIN = 3_628_000.0
SRC_Y_MAX = 4_776_000.0
SRC_PIXEL_SIZE = 1_000.0
# Parametry zapisane w GeoTIFF-ach SatBaltyk (ETRS89-LAEA5220).
LAEA_LAT_0 = 52.0
LAEA_LON_0 = 20.0
LAEA_FALSE_EASTING = 4_321_000.0
LAEA_FALSE_NORTHING = 3_210_000.0
ETRS89_SEMI_MAJOR = 6_378_137.0
ETRS89_INV_FLATTENING = 298.257222101
SRC_NODATA = -999.0
WATCH_POLL_SECONDS = 5
PROCESSOR_MTIME_NS = Path(__file__).stat().st_mtime_ns

FNAME_RE = re.compile(r"^(\d{8})_(\d{6})-")

# vmin/vmax to tylko zakres kolorow: wartosci poza nim dostaja skrajny kolor
# (legenda oznacza to "8+"), ale zostaja w danych - przy zakwicie chlorofil
# bywa kilkukrotnie wyzszy niz 8 mg/m3 i to wlasnie ten punkt jest najciekawszy.
# "valid" to granice fizycznie mozliwych wartosci - poza nimi to blad w danych
# (NaN). "step" to krok kwantyzacji siatki .grid (0.01 = 2 miejsca po przecinku
# jak w odczycie na mapie; zrodlowy chlorofil ma zreszta precyzje 0.1).
#
# Kolormapy: wylacznie perceptualnie jednorodne, bezpieczne dla daltonizmu
# (rodzina matplotlib viridis/plasma/cividis + twilight dla wielkosci katowych) -
# zadnej "teczowej" skali (jet/hsv/turbo), zeby odczyt nie zalezal od percepcji barw.
PRODUCTS = {
    "sst": {
        "label": "Temperatura powierzchni morza (SST)",
        "unit": "°C",
        "vmin": 2.0,
        "vmax": 22.0,
        "cmap": "plasma",
        "circular": False,
        "step": 0.01,
        "valid": (-5.0, 35.0),
    },
    "chla": {
        "label": "Chlorofil a",
        "unit": "mg/m³",
        "vmin": 0.0,
        "vmax": 8.0,
        "cmap": "viridis",
        "circular": False,
        "step": 0.01,
        "valid": (0.0, 300.0),
    },
    "o2": {
        # Metadane eksportu podaja "mg m-3", ale wartosci (8-12) to typowe
        # stezenia tlenu w wodzie w mg/l - opisujemy je jako mg/l.
        "label": "Tlen rozpuszczony",
        "unit": "mg/l",
        "vmin": 6.0,
        "vmax": 13.0,
        "cmap": "magma",
        "circular": False,
        "step": 0.01,
        "valid": (0.0, 30.0),
    },
    "swh": {
        "label": "Wysokość fali (SWH)",
        "unit": "m",
        "vmin": 0.0,
        "vmax": 2.5,
        "cmap": "cividis",
        "circular": False,
        "step": 0.01,
        "valid": (0.0, 25.0),
    },
    "mwdir": {
        "label": "Kierunek fali",
        "unit": "° (od północy, zgodnie z ruchem wskazówek)",
        "vmin": 0.0,
        "vmax": 360.0,
        "cmap": "twilight_shifted",
        "circular": True,
        "step": 0.1,
        "valid": (0.0, 360.0),
    },
}


def find_source_dirs():
    """Kazdy folder bezposrednio w dane/, ktory zawiera podfolder snapshots/,
    jest traktowany jako jeden eksport SatBaltyk - niezaleznie od nazwy."""
    if not DANE_DIR.is_dir():
        return []
    dirs = []
    if (DANE_DIR / "snapshots").is_dir():
        dirs.append(DANE_DIR)
    dirs.extend(d for d in DANE_DIR.iterdir() if d.is_dir() and (d / "snapshots").is_dir())
    return sorted(dirs)


def scan_products(source_dirs):
    """Zwraca (by_product, unknown_products):
    by_product: {produkt: {timestamp_iso: Path}} - tylko produkty znane w PRODUCTS
    unknown_products: {nazwa_produktu: [foldery, w ktorych wystapil]}
    Przy zbieznych znacznikach czasu wygrywa plik z pozniejszego (alfabetycznie) folderu."""
    by_product = {p: {} for p in PRODUCTS}
    unknown = {}
    for export_dir in source_dirs:
        snapshots_dir = export_dir / "snapshots"
        for product_dir in sorted(snapshots_dir.iterdir()):
            if not product_dir.is_dir():
                continue
            product = product_dir.name
            if product not in PRODUCTS:
                unknown.setdefault(product, []).append(export_dir.name)
                continue
            files = list(product_dir.glob("*.tiff")) + list(product_dir.glob("*.i32f"))
            for f in files:
                m = FNAME_RE.match(f.name)
                if not m:
                    continue
                ts = datetime.strptime(m.group(1) + m.group(2), "%Y%m%d%H%M%S").replace(
                    tzinfo=timezone.utc
                )
                by_product[product][ts.isoformat()] = f
    return by_product, unknown


def project_lonlat_to_satbaltyk(lon_deg: np.ndarray, lat_deg: np.ndarray):
    """Wektorowa projekcja ETRS89 -> niestandardowy LAEA uzywany przez SatBaltyk."""
    a = ETRS89_SEMI_MAJOR
    flattening = 1.0 / ETRS89_INV_FLATTENING
    eccentricity_sq = flattening * (2.0 - flattening)
    eccentricity = np.sqrt(eccentricity_sq)

    lon = np.deg2rad(lon_deg)
    lat = np.deg2rad(lat_deg)
    lon_0 = np.deg2rad(LAEA_LON_0)
    lat_0 = np.deg2rad(LAEA_LAT_0)

    def authalic_q(phi):
        sin_phi = np.sin(phi)
        return (1.0 - eccentricity_sq) * (
            sin_phi / (1.0 - eccentricity_sq * sin_phi * sin_phi)
            - np.log((1.0 - eccentricity * sin_phi) / (1.0 + eccentricity * sin_phi))
            / (2.0 * eccentricity)
        )

    q_p = (1.0 - eccentricity_sq) * (
        1.0 / (1.0 - eccentricity_sq)
        - np.log((1.0 - eccentricity) / (1.0 + eccentricity)) / (2.0 * eccentricity)
    )
    beta = np.arcsin(np.clip(authalic_q(lat) / q_p, -1.0, 1.0))
    beta_0 = np.arcsin(np.clip(authalic_q(lat_0) / q_p, -1.0, 1.0))
    radius_q = a * np.sqrt(q_p / 2.0)
    m_0 = np.cos(lat_0) / np.sqrt(1.0 - eccentricity_sq * np.sin(lat_0) ** 2)
    d = a * m_0 / (radius_q * np.cos(beta_0))

    delta_lon = lon - lon_0
    denominator = 1.0 + np.sin(beta_0) * np.sin(beta) + np.cos(beta_0) * np.cos(beta) * np.cos(delta_lon)
    b = radius_q * np.sqrt(2.0 / denominator)
    x = LAEA_FALSE_EASTING + b * d * np.cos(beta) * np.sin(delta_lon)
    y = LAEA_FALSE_NORTHING + (b / d) * (
        np.cos(beta_0) * np.sin(beta) - np.sin(beta_0) * np.cos(beta) * np.cos(delta_lon)
    )
    return x, y


def reproject_satbaltyk_array(arr: np.ndarray) -> np.ndarray:
    """Probkuje LAEA na siatke zgodna z pikselami ImageOverlay w Web Mercator."""
    lon_min, lat_min, lon_max, lat_max = BBOX
    lon_step = (lon_max - lon_min) / GRID_WIDTH
    lons = np.linspace(lon_min + lon_step / 2.0, lon_max - lon_step / 2.0, GRID_WIDTH)

    north_mercator = np.log(np.tan(np.pi / 4.0 + np.deg2rad(lat_max) / 2.0))
    south_mercator = np.log(np.tan(np.pi / 4.0 + np.deg2rad(lat_min) / 2.0))
    mercator_step = (north_mercator - south_mercator) / GRID_HEIGHT
    mercator_rows = np.linspace(
        north_mercator - mercator_step / 2.0,
        south_mercator + mercator_step / 2.0,
        GRID_HEIGHT,
    )
    lats = np.rad2deg(2.0 * np.arctan(np.exp(mercator_rows)) - np.pi / 2.0)
    lon_grid, lat_grid = np.meshgrid(lons, lats)
    x, y = project_lonlat_to_satbaltyk(lon_grid, lat_grid)

    cols = np.floor((x - SRC_X_MIN) / SRC_PIXEL_SIZE).astype(np.int32)
    rows = np.floor((SRC_Y_MAX - y) / SRC_PIXEL_SIZE).astype(np.int32)
    valid = (cols >= 0) & (cols < I32F_WIDTH) & (rows >= 0) & (rows < I32F_HEIGHT)
    result = np.full((GRID_HEIGHT, GRID_WIDTH), np.nan, dtype=np.float32)
    result[valid] = arr[rows[valid], cols[valid]]
    return result


def warp_to_grid(src_path: Path) -> np.ndarray:
    """Przycina+reprojektuje do wspolnej siatki (wiersze rowne w Mercatorze), zwraca float32
    array (GRID_HEIGHT, GRID_WIDTH) z NaN w miejscu NoData."""
    if src_path.suffix.lower() == ".i32f":
        arr = np.fromfile(src_path, dtype="<f4")
        expected = I32F_WIDTH * I32F_HEIGHT
        if arr.size != expected:
            raise ValueError(f"nieoczekiwany rozmiar .i32f: {arr.size} float32, oczekiwano {expected}")
        arr = arr.reshape((I32F_HEIGHT, I32F_WIDTH))
        arr = np.where(arr == SRC_NODATA, np.nan, arr).astype(np.float32)
        return reproject_satbaltyk_array(arr)

    if gdal is None:
        raise RuntimeError("GDAL jest wymagany do przetwarzania GeoTIFF; pliki .i32f dzialaja bez GDAL")

    # GeoTIFF czytamy w calosci (1280x1408, siatka LAEA SatBaltyk) i probkujemy
    # tak samo jak .i32f. NIE uzywamy gdal.Warp do EPSG:4326: wynik ma rowne
    # odstepy szerokosci geograficznej, a Leaflet rozciaga ImageOverlay w Web
    # Mercatorze - nakladka przesuwala sie wzgledem ladu (ok. 0.6 wartosci
    # bledu na komorke, wyraznie widoczne na mapie).
    ds = gdal.Open(str(src_path))
    if (ds.RasterXSize, ds.RasterYSize) != (I32F_WIDTH, I32F_HEIGHT):
        raise ValueError(f"nieoczekiwany rozmiar rastra: {ds.RasterXSize}x{ds.RasterYSize}")
    x0, dx, _, y0, _, dy = ds.GetGeoTransform()
    if (x0, y0, dx, dy) != (SRC_X_MIN, SRC_Y_MAX, SRC_PIXEL_SIZE, -SRC_PIXEL_SIZE):
        raise ValueError(f"nieoczekiwana georeferencja: {ds.GetGeoTransform()}")
    arr = ds.GetRasterBand(1).ReadAsArray().astype(np.float32)
    ds = None
    arr = np.where(arr == SRC_NODATA, np.nan, arr).astype(np.float32)
    return reproject_satbaltyk_array(arr)


FEATHER_PX = round(GRID_WIDTH * 16 / 360)  # ile pikseli od brzegu siatki zanika przezroczystosc (ta sama szerokosc pasa co przy 360 kolumnach)


def feather_alpha(alpha: np.ndarray) -> np.ndarray:
    """Wygasza kanal alpha w pasie FEATHER_PX od kazdej krawedzi siatki -
    zeby prostokat danych nie wygladal jak twardo wyciety kwadrat na mapie,
    tylko naturalnie zanikal ku brzegom obszaru objetego danymi."""
    h, w = alpha.shape
    y = np.arange(h)[:, None]
    x = np.arange(w)[None, :]
    dist_edge = np.minimum(np.minimum(y, h - 1 - y), np.minimum(x, w - 1 - x))
    fade = np.clip(dist_edge / FEATHER_PX, 0, 1)
    return (alpha.astype(np.float32) * fade).astype(np.uint8)


def colorize(arr: np.ndarray, cfg: dict) -> Image.Image:
    valid = ~np.isnan(arr)
    # clip=True: wartosci poza skala dostaja skrajny kolor zamiast znikac
    norm = mcolors.Normalize(vmin=cfg["vmin"], vmax=cfg["vmax"], clip=True)
    colormap = mpl.colormaps[cfg["cmap"]]
    rgba = colormap(norm(np.nan_to_num(arr, nan=cfg["vmin"])))
    rgba = (rgba * 255).astype(np.uint8)
    rgba[..., 3] = np.where(valid, 255, 0)
    rgba[..., 3] = feather_alpha(rgba[..., 3])
    return Image.fromarray(rgba, mode="RGBA")


def make_legend(cfg: dict, path: Path, width=256, height=28):
    norm = mcolors.Normalize(vmin=cfg["vmin"], vmax=cfg["vmax"])
    colormap = mpl.colormaps[cfg["cmap"]]
    gradient = np.linspace(cfg["vmin"], cfg["vmax"], width)
    rgba = colormap(norm(gradient))
    rgba = (rgba[:, :3] * 255).astype(np.uint8)
    img = np.tile(rgba, (height, 1, 1))
    Image.fromarray(img, mode="RGB").save(path)


# Format .grid: naglowek (little-endian) u16 szerokosc, u16 wysokosc, f32 krok
# kwantyzacji, potem strumien zlib z int16 (wiersz po wierszu, kazda wartosc
# jako roznica wzgledem poprzedniej w wierszu - gladkie dane kompresuja sie
# wtedy kilkukrotnie lepiej). Wartosc = int16 * krok, NODATA_Q oznacza brak
# danych. Przegladarka rozpakowuje to DecompressionStream (src/utils/grid.js).
NODATA_Q = -32768
GRID_HEADER = struct.Struct("<HHf")


def write_grid(path: Path, arr: np.ndarray, step: float):
    q = np.full(arr.shape, NODATA_Q, dtype=np.int16)
    valid = ~np.isnan(arr)
    q[valid] = np.clip(np.round(arr[valid] / step), -32767, 32767).astype(np.int16)
    delta = np.diff(q, axis=1, prepend=np.zeros((arr.shape[0], 1), dtype=np.int16))  # int16 zawija sie tak samo jak przy sumowaniu w JS
    height, width = arr.shape
    path.write_bytes(GRID_HEADER.pack(width, height, step) + zlib.compress(delta.astype("<i2").tobytes(), 9))


def read_grid(path: Path) -> np.ndarray:
    """Odczyt .grid do float32 z NaN (do statystyk i kontroli po stronie skryptu)."""
    data = path.read_bytes()
    width, height, step = GRID_HEADER.unpack_from(data)
    delta = np.frombuffer(zlib.decompress(data[GRID_HEADER.size :]), dtype="<i2").reshape((height, width))
    q = np.cumsum(delta, axis=1, dtype=np.int16)
    arr = q.astype(np.float32) * np.float32(step)
    arr[q == NODATA_Q] = np.nan
    return arr


def output_grid_ok(path: Path) -> bool:
    if not path.exists():
        return False
    try:
        return read_grid(path).shape == (GRID_HEIGHT, GRID_WIDTH)
    except (OSError, ValueError, zlib.error, struct.error):
        return False


def process_product(product: str, cfg: dict, files: dict, report: dict) -> dict:
    out_dir = OUT_DIR / product
    out_dir.mkdir(parents=True, exist_ok=True)

    make_legend(cfg, out_dir / "legend.png")

    entries = []
    for ts_iso in sorted(files):
        src = files[ts_iso]
        stamp = ts_iso.replace(":", "").replace("-", "").replace("+0000", "Z")
        png_path = out_dir / f"{stamp}.png"
        grid_path = out_dir / f"{stamp}.grid"
        (out_dir / f"{stamp}.f32").unlink(missing_ok=True)  # pozostalosc po starym formacie siatek
        outputs_fresh = (
            png_path.exists()
            and grid_path.exists()
            and png_path.stat().st_mtime_ns >= src.stat().st_mtime_ns
            and grid_path.stat().st_mtime_ns >= src.stat().st_mtime_ns
            and png_path.stat().st_mtime_ns >= PROCESSOR_MTIME_NS
            and grid_path.stat().st_mtime_ns >= PROCESSOR_MTIME_NS
        )
        grid_ok = outputs_fresh and output_grid_ok(grid_path)

        if not png_path.exists() or not grid_ok:
            try:
                arr = warp_to_grid(src)
                if cfg["circular"]:
                    # mwdir w plikach zrodlowych jest w konwencji -180..180 -
                    # sprowadzamy do standardowych 0..360 (od polnocy, zgodnie z ruchem wskazowek)
                    arr = np.where(np.isnan(arr), arr, (arr + 360.0) % 360.0)
                lo, hi = cfg["valid"]
                arr = np.where((arr >= lo) & (arr <= hi), arr, np.nan)
                colorize(arr, cfg).save(png_path, optimize=True)
                write_grid(grid_path, arr, cfg["step"])
            except Exception as exc:  # noqa: BLE001 - chcemy przetworzyc reszte mimo bledu jednego pliku
                report["failed"].append(f"{product}/{src.name}: {exc}")
                png_path.unlink(missing_ok=True)
                grid_path.unlink(missing_ok=True)
                continue
            report["new"].append(f"{product}/{stamp}")
            print(f"  [{product}] {stamp} <- {src.name}")

        valid = read_grid(grid_path)
        valid = valid[~np.isnan(valid)]
        stats = (
            {"min": float(valid.min()), "max": float(valid.max()), "mean": float(valid.mean())}
            if valid.size
            else None
        )

        entries.append(
            {
                "t": ts_iso,
                "png": f"data/{product}/{stamp}.png",
                "grid": f"data/{product}/{stamp}.grid",
                "stats": stats,
            }
        )

    return {
        "label": cfg["label"],
        "unit": cfg["unit"],
        "vmin": cfg["vmin"],
        "vmax": cfg["vmax"],
        "circular": cfg["circular"],
        "grid": {"width": GRID_WIDTH, "height": GRID_HEIGHT},
        "legend": f"data/{product}/legend.png",
        "timestamps": entries,
    }


def run_once() -> dict:
    """Pojedynczy przebieg: skanuje dane/, dopisuje brakujace warstwy,
    zapisuje manifest.json. Zwraca raport (do wypisania w main/watch)."""
    source_dirs = find_source_dirs()
    report = {"new": [], "failed": [], "kept": [], "unknown": {}, "source_dirs": len(source_dirs)}

    if not source_dirs:
        return report

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    by_product, unknown = scan_products(source_dirs)
    report["unknown"] = unknown

    # Produkty, ktorych nie ma w biezacych eksportach (np. fale - eksport moze
    # zawierac tylko czesc parametrow), zachowujemy z poprzedniego manifestu,
    # zeby nowy eksport nie wymazywal ich z dashboardu.
    previous = {}
    old_manifest_path = OUT_DIR / "manifest.json"
    if old_manifest_path.exists():
        try:
            previous = json.loads(old_manifest_path.read_text(encoding="utf-8")).get("products", {})
        except (OSError, ValueError):
            previous = {}

    manifest = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "bbox": list(BBOX),
        "products": {},
    }
    for product, cfg in PRODUCTS.items():
        if not by_product[product] and previous.get(product, {}).get("timestamps"):
            manifest["products"][product] = previous[product]
            report["kept"].append(product)
            continue
        manifest["products"][product] = process_product(product, cfg, by_product[product], report)

    manifest_path = OUT_DIR / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    report["manifest_path"] = str(manifest_path)
    return report


def print_report(report: dict):
    if report["source_dirs"] == 0:
        print(f"Brak folderow eksportu w {DANE_DIR} (oczekuje sie */snapshots/<produkt>/*.tiff).", file=sys.stderr)
        return

    for name, seen_in in report["unknown"].items():
        print(
            f"  UWAGA: nieznany produkt '{name}' w {', '.join(seen_in)} - pominięto. "
            f"Dodaj wpis do PRODUCTS w scripts/process_data.py, żeby go przetwarzać.",
            file=sys.stderr,
        )
    for msg in report["failed"]:
        print(f"  UWAGA: nie udało się przetworzyć {msg} - pominięto.", file=sys.stderr)

    if report["kept"]:
        print(f"Bez nowych plików w eksporcie - zachowano poprzednie warstwy: {', '.join(report['kept'])}")
    if report["new"]:
        print(f"Nowe klatki: {len(report['new'])}")
    else:
        print("Brak nowych klatek (wszystko już przetworzone).")
    if report.get("manifest_path"):
        print(f"Manifest: {report['manifest_path']}")


def dane_fingerprint():
    """Lekki 'odcisk palca' zawartosci dane/ - do wykrywania zmian w trybie --watch
    bez ciaglego przeliczania danych od nowa."""
    if not DANE_DIR.is_dir():
        return ()
    return tuple(
        sorted(
            (str(f.relative_to(DANE_DIR)), f.stat().st_mtime_ns, f.stat().st_size)
            for pattern in ("*.tiff", "*.i32f")
            for f in DANE_DIR.rglob(pattern)
        )
    )


def watch():
    print(f"Obserwuję {DANE_DIR} (co {WATCH_POLL_SECONDS}s) - Ctrl+C żeby zakończyć.", flush=True)
    last_fp = None
    try:
        while True:
            fp = dane_fingerprint()
            if fp != last_fp:
                print(
                    f"\n[{datetime.now().strftime('%H:%M:%S')}] Wykryto zmianę w {DANE_DIR}, przetwarzam...",
                    flush=True,
                )
                print_report(run_once())
                sys.stdout.flush()
                last_fp = fp
            time.sleep(WATCH_POLL_SECONDS)
    except KeyboardInterrupt:
        print("\nZatrzymano.")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument(
        "--watch",
        action="store_true",
        help="nie kończ po jednym przebiegu - pilnuj dane/ i przetwarzaj nowe pliki na bieżąco",
    )
    args = parser.parse_args()

    if args.watch:
        watch()
        return

    print_report(run_once())


if __name__ == "__main__":
    main()
