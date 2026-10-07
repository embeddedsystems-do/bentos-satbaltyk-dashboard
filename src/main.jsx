import React from "react";
import ReactDOM from "react-dom/client";
// Czcionki jak na bentos.info - hostowane razem z aplikacja (fontsource),
// bez zaleznosci od zewnetrznego CDN (Fontshare nie serwuje Open Sauce Sans).
import "@fontsource/open-sauce-sans/400.css";
import "@fontsource/open-sauce-sans/500.css";
import "@fontsource/open-sauce-sans/600.css";
import "@fontsource/open-sauce-sans/700.css";
import "@fontsource/space-mono/400.css";
import "@fontsource/space-mono/700.css";
import App from "./App.jsx";
import { I18nProvider } from "./i18n.jsx";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </React.StrictMode>
);
