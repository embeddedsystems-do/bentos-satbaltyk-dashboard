import { PRODUCT_ICONS } from "./icons";
import { useI18n } from "../i18n";

export const PRODUCT_ORDER = ["sst", "chla", "o2", "swh", "mwdir"];

// Kompaktowa siatka kwadratowych kafelkow (ikona + krotka nazwa) zamiast
// listy przyciskow - kilka warstw miesci sie w jednym rzedzie i nie spycha
// reszty panelu. Pelna nazwa aktywnej warstwy jest w naglowku pod spodem,
// a dla pozostalych w podpowiedzi (title) i aria-label.
export default function Sidebar({ products, activeProduct, onSelect }) {
  const { t } = useI18n();
  return (
    <nav className="product-grid" aria-label={t("sidebar.layers")}>
      {PRODUCT_ORDER.filter((key) => products[key]).map((key) => {
        const isActive = key === activeProduct;
        const Icon = PRODUCT_ICONS[key];
        const fullName = t(`product.${key}`);
        return (
          <button
            key={key}
            className={`product-tile${isActive ? " is-active" : ""}`}
            onClick={() => onSelect(key)}
            aria-pressed={isActive}
            aria-label={fullName}
            title={fullName}
          >
            {Icon && (
              <span className="product-tile-icon">
                <Icon />
              </span>
            )}
            <span className="product-tile-label">{t(`product.short.${key}`)}</span>
          </button>
        );
      })}
    </nav>
  );
}
