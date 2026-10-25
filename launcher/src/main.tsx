import React from "react";
import ReactDOM from "react-dom/client";
import { LauncherProvider } from "./store";
import App from "./App";
import "./styles.css";
import "./skins.css";
import "./true-pixel.css";
import "./pixel-night.css";
import "./standard-workbench.css";
import "./airdrop.css";
import "./social.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode><LauncherProvider><App /></LauncherProvider></React.StrictMode>,
);
