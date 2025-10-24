// Supported-viewport policy (docs/viewport-policy.md). Sets data-viewport on
// .app and manages collapsible rail + inspector overlay modes.

import { store } from "./state.js";
import { bus } from "./bus.js";

export const BREAKPOINTS = {
  desktop: 1100,
  tablet: 768,
};

let appRoot = null;
let mqDesktop = null;
let mqTablet = null;

export function classify(width = window.innerWidth) {
  if (width >= BREAKPOINTS.desktop) return "desktop";
  if (width >= BREAKPOINTS.tablet) return "tablet";
  return "narrow";
}

export function current() {
  return store.get("ui.viewport") ?? classify();
}

function applyClass(vp) {
  if (!appRoot) return;
  appRoot.dataset.viewport = vp;
  store.set("ui.viewport", vp);
  // Non-desktop: inspector must overlay (CSS), rail starts collapsed unless
  // the researcher explicitly opened it.
  if (vp !== "desktop") {
    if (store.get("ui.railOpen") == null) setRailOpen(false);
  } else if (store.get("ui.railOpen") === false && !appRoot.hasAttribute("data-fullbleed")) {
    // Desktop default: rail visible unless full-bleed or user collapsed it.
    // Leave explicit user preference alone once set.
  }
  bus.emit("viewport:changed", { viewport: vp });
}

export function setRailOpen(open) {
  if (!appRoot) return;
  const next = Boolean(open);
  store.set("ui.railOpen", next);
  appRoot.dataset.rail = next ? "open" : "collapsed";
  const btn = document.getElementById("rail-toggle");
  if (btn) {
    btn.setAttribute("aria-expanded", next ? "true" : "false");
    btn.setAttribute("aria-label", next ? "Collapse navigation" : "Open navigation");
  }
  const scrim = document.getElementById("rail-scrim");
  if (scrim) scrim.hidden = !(next && current() !== "desktop");
}

export function toggleRail() {
  setRailOpen(!(store.get("ui.railOpen") ?? current() === "desktop"));
}

export function init({ app } = {}) {
  appRoot = app ?? document.getElementById("app");
  if (!appRoot) return;

  mqDesktop = window.matchMedia(`(min-width: ${BREAKPOINTS.desktop}px)`);
  mqTablet = window.matchMedia(`(min-width: ${BREAKPOINTS.tablet}px)`);

  const sync = () => {
    const vp = classify();
    applyClass(vp);
    if (vp === "desktop") {
      // First paint on desktop: open rail unless fullbleed.
      if (!appRoot.hasAttribute("data-fullbleed") && store.get("ui.railOpen") == null) {
        setRailOpen(true);
      } else {
        setRailOpen(store.get("ui.railOpen") !== false);
      }
    } else {
      // Overlay mode: keep researcher preference, default closed.
      setRailOpen(Boolean(store.get("ui.railOpen")));
    }
  };

  sync();
  mqDesktop.addEventListener?.("change", sync);
  mqTablet.addEventListener?.("change", sync);
  window.addEventListener("resize", sync);

  document.getElementById("rail-toggle")?.addEventListener("click", () => toggleRail());
  document.getElementById("rail-scrim")?.addEventListener("click", () => setRailOpen(false));

  // Close overlay rail after a nav selection on non-desktop.
  bus.on("route:changed", () => {
    if (current() !== "desktop") setRailOpen(false);
  });
}
