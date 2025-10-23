export default function Home() {
  // title gives the embedded app an accessible name (screen readers announce
  // the frame); the inner app owns routing and its own document.title.
  return <iframe title="Nexus IQ" src="/app/index.html" style={{ border: "none", width: "100%", height: "100vh" }} />;
}
