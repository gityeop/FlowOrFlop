import React from "react";
import ReactDOM from "react-dom/client";

import { OverlayApp } from "./windows/overlay/OverlayApp";
import { SettingsApp } from "./windows/settings/SettingsApp";
import "./styles.css";

const params = new URLSearchParams(window.location.search);
const isOverlayWindow = params.get("window") === "overlay";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>{isOverlayWindow ? <OverlayApp /> : <SettingsApp />}</React.StrictMode>,
);
