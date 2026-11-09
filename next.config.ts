import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  serverExternalPackages: ['sharp', '@techstark/opencv-js'],
  outputFileTracingIncludes: {
    '/api/extract': [
      './node_modules/@techstark/opencv-js/package.json',
      './node_modules/@techstark/opencv-js/dist/opencv.js',
    ],
  },
}

export default nextConfig
