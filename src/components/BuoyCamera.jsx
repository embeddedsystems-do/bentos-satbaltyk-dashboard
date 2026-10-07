import { useI18n } from "../i18n";

const VIDEO_ID = "h0F818upkgI";
const STREAM_URL = `https://www.youtube-nocookie.com/embed/${VIDEO_ID}?autoplay=1&mute=1&playsinline=1&rel=0`;
const SOURCE_URL = `https://www.youtube.com/watch?v=${VIDEO_ID}`;

export default function BuoyCamera() {
  const { t } = useI18n();
  return (
    <div className="buoy-camera buoy-camera-real">
      <iframe
        className="buoy-camera-frame"
        title={t("camera.title")}
        src={STREAM_URL}
        allow="accelerometer; autoplay; encrypted-media; fullscreen; picture-in-picture"
        allowFullScreen
      />
      <div className="buoy-camera-osd">
        <span>{t("camera.public")}</span>
        <span>Aquarium of the Pacific · Tropical Reef</span>
      </div>
      <a className="buoy-camera-source" href={SOURCE_URL} target="_blank" rel="noreferrer">
        {t("camera.source")}
      </a>
    </div>
  );
}
