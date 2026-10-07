import { formatTimestamp } from "../utils/grid";
import { useI18n } from "../i18n";

const SPEEDS = [0.5, 1, 2, 4];

export default function TimeControl({ timestamps, index, onChange, playing, onTogglePlay, speed, onSpeedChange }) {
  const { locale, t } = useI18n();
  const entry = timestamps[index];

  return (
    <div className="time-control">
      <div className="time-control-row">
        <button
          className="play-btn"
          onClick={onTogglePlay}
          aria-label={t(playing ? "time.pause" : "time.play")}
        >
          {playing ? "⏸" : "▶"}
        </button>
        <input
          type="range"
          min={0}
          max={timestamps.length - 1}
          value={index}
          onChange={(e) => onChange(Number(e.target.value))}
          className="time-slider"
        />
      </div>
      <div className="time-label">
        {entry ? formatTimestamp(entry.t, locale) : "—"}
        <span className="time-label-tz"> ({t("time.local")})</span>
      </div>
      <div className="speed-row">
        <span className="speed-label">{t("time.speed")}</span>
        {SPEEDS.map((s) => (
          <button
            key={s}
            className={`speed-btn${speed === s ? " is-active" : ""}`}
            onClick={() => onSpeedChange(s)}
          >
            {s}×
          </button>
        ))}
      </div>
    </div>
  );
}
