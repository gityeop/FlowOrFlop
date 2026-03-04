import React from "react";
import ReactDOM from "react-dom/client";

import { CalibrationGuideApp } from "./windows/calibration/CalibrationGuideApp";
import { OverlayApp } from "./windows/overlay/OverlayApp";
import { SettingsApp } from "./windows/settings/SettingsApp";
import "./styles.css";

const params = new URLSearchParams(window.location.search);
const isOverlayWindow = params.get("window") === "overlay";
const isCalibrationWindow = params.get("window") === "calibration";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {isOverlayWindow ? (
      <OverlayApp />
    ) : isCalibrationWindow ? (
      <CalibrationGuideApp />
    ) : (
      <SettingsApp />
    )}
  </React.StrictMode>,
);
