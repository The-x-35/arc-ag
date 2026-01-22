/** @type {import('next').NextConfig} */
const path = require('path');
const webpack = require('webpack');

const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  webpack: (config) => {
    // Prevent browser bundle from trying to include node built-ins required by privacycash/node-localstorage
    config.resolve.fallback = {
      ...(config.resolve.fallback || {}),
      fs: false,
      path: require.resolve('path-browserify'),
      os: false,
      crypto: require.resolve('crypto-browserify'),
      stream: require.resolve('stream-browserify'),
      buffer: require.resolve('buffer'),
    };
    
    // Support .wasm modules needed by @lightprotocol/hasher.rs
    config.experiments = {
      ...(config.experiments || {}),
      asyncWebAssembly: true,
    };
    
    config.module.rules.push({
      test: /\.wasm$/i,
      type: 'asset/resource',
    });
    
    // Alias node-localstorage to a browser-safe stub and neutralize node: imports
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      'node-localstorage': path.join(__dirname, 'lib', 'node-localstorage-stub.ts'),
      'node:path': path.join(__dirname, 'lib', 'path-shim.js'),
      'node:fs': path.join(__dirname, 'lib', 'empty.js'),
      'hasher_wasm_simd_bg.wasm': path.join(__dirname, 'public', 'wasm', 'hasher_wasm_simd_bg.wasm'),
      'light_wasm_hasher_bg.wasm': path.join(__dirname, 'public', 'wasm', 'light_wasm_hasher_bg.wasm'),
      'pino-pretty': path.join(__dirname, 'lib', 'empty.js'),
    };
    
    // Handle node: scheme imports explicitly
    config.plugins = config.plugins || [];
    config.plugins.push(
      new webpack.NormalModuleReplacementPlugin(
        /^node:path$/,
        require.resolve('path-browserify')
      )
    );
    config.plugins.push(
      new webpack.NormalModuleReplacementPlugin(
        /^node:fs$/,
        path.join(__dirname, 'lib', 'empty.js')
      )
    );
    
    // Provide Buffer polyfill
    config.plugins.push(
      new webpack.ProvidePlugin({
        Buffer: ['buffer', 'Buffer'],
      })
    );
    
    return config;
  },
};

module.exports = nextConfig;
