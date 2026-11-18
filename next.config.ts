import type { NextConfig } from 'next'

const BACKGROUND_REMOVAL_DIST = './node_modules/@imgly/background-removal-node/dist'
const SMALL_MODEL_CHUNKS = [
  'b34a3e9350ad77140964b6a2e1e32cd9738acd9d01e5899b96be71901a22ef47',
  '8a85c22e472bed10198298a3d57480a5a90946dba88bddecf8b0bf0eafc06e70',
  '5faec25d2338ae8ca2c7bff72e954cebd40a04c5f34c4b6bb8ca6720fae40996',
  'b9861d932a549be455fc8ebd8ce5d413049515bfdd3edd55e136dbe05dd34ef5',
  'f070b4c4f512cfe8dd6936c3cb9a616f132894867d3d33304d83599eb6b55636',
  '10d02652d10fbc47bf93732ff9e8ad53eefbd3bd89ab3c1fbc15ddd740bea672',
  '014c9e0229363137e92b85ed3c6f56b1386c279cdd9af2d7f1960ed8428b5e94',
  '34dd3ad760f7e31b5e9144b8c387b8ecd6dc43116248c93c56dd7051ab525e3b',
  'e7ca5cc3e0afd65581642a05ac91eb8ea4d0deb868df94b8981c910212526476',
  '0ad4ebb86cfdd847901427181b7a7804dba93d868c3cd5f11a294acf36c9413f',
  '9582c0375aed822c5577a814766c4afc6c096f4ccd3b0d08af6a1794987206a1',
]
const MEDIUM_MODEL_CHUNKS = [
  'fe1b9f06af9d2147016884f4eb683d4dc540244a7453c3b742ae527725df2eec',
  '724543b36c7b5eddfbd7f55cb5a7c1676b2089c277611850c257efa42212d8a2',
  'f9290547b2e34555536647c1e2ca456348170eef1aee05d8fd522f5a051f260c',
  '897d4d8a3f9f8c07f439300a5d81c8be4b0fcecf19ca6d77929b1750fedd8306',
  'cbcda0a0c830ba51928e7935d9d3cfe1c4dc258bf117f2c76d047113ab8f9f8c',
  '4c44c8b64af9f044623ceace7cc55e0bc348394f7ff63629d46118c0a03c9c54',
  '8b2e3d773d7084c5cfac1c04d69d3586e4b8914a840d2b582dfde4940d698957',
  '024e3d8beaf517d25496b73e36b0e0498110652753273e0dd8b591ad7c1c9e2f',
  '1b8eaad4cd019b76e7eba964a38711a0bdeafbd10b6208c1107403a64dbd902a',
  '0c8c5c24237304482ccc70a50008b73c8ef53e4656068da32b635607cca0c8c9',
  'a5b8c519c832bc46b2ae5a9887fac1e3d5cc76a04846d8c3544875c7f2b40960',
  '7b1dd767c5c1c0156b8d13bb34d4c1d11e014723b10cddc25c93e89a28e7cd96',
  '3f5638267419916c9d4d906ff25f721d3d2e034851ea01566f0d2d6f943550b8',
  '9927e74b3a0638d4cf5701e78e66d77476a4ba68c75831f1c8ea9117ec7f8809',
  '3315eb3c14ca3ff5c03c80fac58f486a14264dd0bb9c168c096f2bd2531ba438',
  '230f667e0332dc09ef08aacbf1992c40ce112192f95dfc14231a3ef515f9a2c7',
  'e01a157b677e0e17815cd738dcda7e6daa268898d006b52b5d3604c439e6c96e',
  '529f1df7d027b0315090ba15d42ef32998cac2efd6783c62f6b11cedf4c548f3',
  '6cfd013f552a05e9fc81156e6d6de593668e0247a3970feae22e285c16d13e62',
  '3f31511c3c16a29cf81b32379f51ead2bd082677b48b1dcc11a66beeb37cc729',
  '01f6efcc8a01c727d99073ceede8e64c654fa3c4612b006e69e22dc663236943',
  '145d8355f50b7847de5d04815124790867fe1752a0013bdf6ce28882b5e0a2fc',
]

const nextConfig: NextConfig = {
  serverExternalPackages: ['sharp', '@imgly/background-removal-node', 'onnxruntime-node'],
  outputFileTracingIncludes: {
    '/api/extract': [
      `${BACKGROUND_REMOVAL_DIST}/resources.json`,
      ...MEDIUM_MODEL_CHUNKS.map((chunk) => `${BACKGROUND_REMOVAL_DIST}/${chunk}`),
      './node_modules/onnxruntime-node/bin/napi-v3/linux/x64/**/*',
    ],
  },
  outputFileTracingExcludes: {
    '/api/extract': SMALL_MODEL_CHUNKS.map((chunk) => `${BACKGROUND_REMOVAL_DIST}/${chunk}`),
  },
}

export default nextConfig
