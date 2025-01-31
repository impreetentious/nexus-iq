const nextConfig = {
  async rewrites() {
    const PORT = process.env.NXQ_PORT || 7341;
    return [
      { source: '/api/:path*', destination: `http://localhost:${PORT}/api/:path*` },
    ];
  },
};

export default nextConfig;
