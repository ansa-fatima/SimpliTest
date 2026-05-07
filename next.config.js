/** @type {import('next').NextConfig} */
const nextConfig = {
  // Required for the Docker/CapRover deployment — builds a self-contained
  // server bundle in .next/standalone with only production deps.
  output: 'standalone',
};
module.exports = nextConfig;
