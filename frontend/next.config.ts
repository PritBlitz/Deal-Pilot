import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // All quote data is fetched client-side from the Python API, so there is no
  // server-side data to cache: keep the default (non-cacheComponents) model.

  // Base URL of the Python API, inlined into the browser bundle at build time.
  // `API_URL` is preferred (some hosts discourage NEXT_PUBLIC_* names);
  // `NEXT_PUBLIC_API_URL` still works. Unset → http://localhost:8000.
  env: {
    API_URL: process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || "",
  },
};

export default nextConfig;
