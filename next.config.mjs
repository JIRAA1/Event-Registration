/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: ['192.168.137.1'],
  turbopack: { root: process.cwd() },
};

export default nextConfig;
