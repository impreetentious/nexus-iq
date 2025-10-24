import { useEffect, useRef, useState } from "react";

// The research app is deliberately served as a plain static shell inside the
// Next host. Keep its hash route in the TOP-LEVEL URL as well: copied links,
// browser back/forward, and the document title then describe the actual screen
// rather than a featureless iframe host.
const routeHash = (value) => (typeof value === "string" && value.startsWith("#/") ? value : "#/");

export default function Home() {
  const frameRef = useRef(null);
  const [src, setSrc] = useState("/app/index.html#/");

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return undefined;

    const requestChildRoute = () => {
      try {
        // A fast initial child boot can publish its first route before this
        // effect attaches the listener. The tiny same-origin handshake makes
        // the initial title as reliable as later navigation events.
        frame.contentWindow?.postMessage({ type: "nexus-iq:request-route" }, window.location.origin);
      } catch {
        // The frame may still be navigating; its load handler asks again.
      }
    };

    const syncChildRoute = () => {
      const hash = routeHash(window.location.hash);
      try {
        // Same origin by construction. Updating only the child hash preserves
        // its loaded state when the user uses the browser's Back button.
        if (frame.contentWindow?.location.pathname === "/app/index.html") {
          if (frame.contentWindow.location.hash !== hash) frame.contentWindow.location.hash = hash;
          requestChildRoute();
          return;
        }
      } catch {
        // During iframe navigation, use src as the conservative fallback.
      }
      const next = `/app/index.html${hash}`;
      setSrc((current) => (current === next ? current : next));
    };

    const receiveChildRoute = (event) => {
      if (event.origin !== window.location.origin || event.source !== frame.contentWindow) return;
      const message = event.data;
      if (!message || message.type !== "nexus-iq:route") return;
      const hash = routeHash(message.hash);
      if (window.location.hash !== hash) {
        window.history.pushState(null, "", `${window.location.pathname}${window.location.search}${hash}`);
      }
      if (typeof message.title === "string" && message.title) document.title = message.title;
    };

    window.addEventListener("message", receiveChildRoute);
    const onFrameLoad = () => {
      syncChildRoute();
      requestChildRoute();
    };
    frame.addEventListener("load", onFrameLoad);
    window.addEventListener("hashchange", syncChildRoute);
    window.addEventListener("popstate", syncChildRoute);
    syncChildRoute();
    return () => {
      frame.removeEventListener("load", onFrameLoad);
      window.removeEventListener("hashchange", syncChildRoute);
      window.removeEventListener("popstate", syncChildRoute);
      window.removeEventListener("message", receiveChildRoute);
    };
  }, []);

  return <iframe ref={frameRef} title="Nexus IQ" src={src} style={{ border: "none", width: "100%", height: "100vh" }} />;
}
