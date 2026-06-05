import React from "react";
import ReactDOM from "react-dom/client";
import "streamdown/styles.css";

import App from "./App";
import "./main.css";

document.documentElement.classList.add("dark");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
