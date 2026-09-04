// The shell is an iframe host and an /api/* proxy; its CSP governs both roles.
const contentSecurityPolicy = [
  "default-src 'self'",
  // The static UI's before-paint theme bootstrap is identical in index.html
  // and coder.html; pin its hash instead of allowing arbitrary inline script.
  "script-src 'self' 'sha256-tV4f2rkRnIiqe4ll6CI3Y6ndYA2usdqlyQjVsaNnCxM='",
  // Report drafts intentionally carry their own CSS when downloaded as HTML.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'self'",
].join("; ");

const nextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key:
              process.env.NODE_ENV === "development"
                ? "Content-Security-Policy-Report-Only"
                : "Content-Security-Policy",
            value: contentSecurityPolicy,
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
          },
        ],
      },
    ];
  },
  async rewrites() {
    const PORT = process.env.NXQ_PORT || 7341;
    return [{ source: "/api/:path*", destination: `http://localhost:${PORT}/api/:path*` }];
  },
};

export default nextConfig;
