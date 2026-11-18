import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  serverExternalPackages: ['sharp', '@imgly/background-removal-node', 'onnxruntime-node'],
  outputFileTracingIncludes: {
    '/api/extract': [
      './node_modules/@imgly/background-removal-node/dist/**/*',
      './node_modules/onnxruntime-node/bin/**/*',
    ],
  },
}

export default nextConfig
