import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  serverExternalPackages: ['sharp', '@techstark/opencv-js'],
}

export default nextConfig
