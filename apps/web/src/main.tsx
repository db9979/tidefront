import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/trpc.ts";
import { App } from "./App.tsx";
import "./fonts.ts";
import "./styles.css";
import { IconDefs } from "./icons.tsx";
import { installBugLog } from "./lib/bug-log.ts";

// Client-Log für „Fehler melden“ so früh wie möglich.
installBugLog();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <IconDefs />
      <App />
    </QueryClientProvider>
  </StrictMode>,
);

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => void navigator.serviceWorker.register("/sw.js"));
}
