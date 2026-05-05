/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allow `npm run build:check` to use a separate dist dir so it doesn't
  // clobber the running dev server's .next cache (which causes a
  // MODULE_NOT_FOUND on /611.js until you `rm -rf .next` and restart).
  distDir: process.env.NEXT_DIST_DIR || '.next',
};

module.exports = nextConfig;
