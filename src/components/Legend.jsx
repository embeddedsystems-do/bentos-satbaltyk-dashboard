export default function Legend({ product }) {
  if (!product) return null;
  const { legend, vmin, vmax, unit, circular } = product;

  return (
    <div className="legend">
      <img src={legend} alt="" className="legend-strip" />
      <div className="legend-ticks">
        {circular ? (
          <>
            <span>N</span>
            <span>E</span>
            <span>S</span>
            <span>W</span>
            <span>N</span>
          </>
        ) : (
          <>
            {/* wartosci poza skala maja skrajny kolor, stad "+" (i "≤", gdy dol skali to nie zero) */}
            <span>{vmin > 0 ? `≤${vmin}` : vmin}</span>
            <span>{(vmin + vmax) / 2}</span>
            <span>
              {vmax}+ {unit}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
