import type { NextConfig } from "next";

// All quote data is fetched client-side from the Python API, so there is no
// server-side data to cache: keep the default (non-cacheComponents) model.
const nextConfig: NextConfig = {};

export default nextConfig;
