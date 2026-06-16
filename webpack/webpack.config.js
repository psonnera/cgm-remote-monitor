const path = require('path');
const webpack = require('webpack');
const pluginArray = [];
const MomentTimezoneDataPlugin = require('moment-timezone-data-webpack-plugin');
const projectRoot = path.resolve(__dirname, '..');

pluginArray.push(new webpack.ProvidePlugin({
  $: 'jquery',
  jQuery: 'jquery',
  'window.jQuery': 'jquery',
  'window.$': 'jquery'
}));

pluginArray.push(new webpack.ProvidePlugin({
  process: 'process/browser',
}));

// limit Timezone data from Moment

pluginArray.push(new MomentTimezoneDataPlugin({
  startYear: 2015,
  endYear: 2035,
}));

// Drop moment's bundled locale files (~150 KB). The client never calls
// moment.locale() — only the server-side alexa/googlehome API plugins do, and
// those load locales via Node, not this webpack bundle. English ("en") is built
// into moment's core, so the client keeps full date formatting.
pluginArray.push(new webpack.IgnorePlugin({
  resourceRegExp: /^\.\/locale$/,
  contextRegExp: /moment$/,
}));

function makeRules (enableSourceMaps) {
  return [
  {
    test: /\.(js|jsx)$/,
    use: {
      loader: 'babel-loader',
      options: {
        babelrc: true,
        cacheDirectory: true,
        extends: path.join(projectRoot, '/.babelrc')
      }
    }
  },
  {
    test: /\.css$/i,
    use: [ 'style-loader',
      {
        loader: 'css-loader',
        options: {
          sourceMap: enableSourceMaps,
        },
      } ],
    exclude: /node_modules/
  },
  {
    test: /\.(jpe?g|png|gif)$/i,
    loader: 'file-loader',
    options: {
      outputPath: 'images'
      //the images will be emitted to public/assets/images/ folder
      //the images will be put in the DOM <style> tag as eg. background: url(assets/images/image.png);
    },
    exclude: /node_modules/
  },
  {
    test: require.resolve('jquery'),
    loader: 'expose-loader',
    options: {
      exposes: ['$']
    }
  }
  ];
}

const appEntry = ['./bundle/bundle.source.js'];
const clockEntry = ['./bundle/bundle.clocks.source.js'];
const retroEntry = ['./bundle/bundle.retro.source.js'];

const publicPath = '/bundle/';

// splitChunks extracts shared vendor dependencies into a separate cacheable chunk
// This reduces duplication between app and retro bundles (~1.5 MiB savings)
const optimization = {
  splitChunks: {
    cacheGroups: {
      // Extract shared vendor code from app and retro bundles
      vendor: {
        test: /[\\/]node_modules[\\/]/,
        name: 'vendor',
        // Only split chunks used by both app and retro (not clock - it's already small)
        chunks: (chunk) => ['app', 'retro'].includes(chunk.name),
        // Always create vendor chunk for matched modules
        minSize: 0,
        minChunks: 1,
        priority: 10,
        enforce: true
      }
    }
  }
};


module.exports = (env, argv) => {
  // Honor the CLI --mode flag (bundle-dev passes "development"); default to production.
  const mode = (argv && argv.mode) ? argv.mode : 'production';
  const isProduction = mode === 'production';
  // Source maps are a dev-only debugging aid. In production they add ~10 MB of
  // .map files for zero runtime benefit, so emit them only for development builds.
  const devtool = isProduction ? false : 'source-map';

  const output = {
    path: path.resolve(projectRoot, './node_modules/.cache/_ns_cache/public'),
    publicPath,
    filename: 'js/bundle.[name].js',
    // Wipe stale outputs (e.g. orphaned .map files) on every build so the
    // served directory only ever contains current artifacts.
    clean: true,
  };
  if (!isProduction) {
    output.sourceMapFilename = 'js/bundle.[name].js.map';
  }

  return {
  mode,
  context: projectRoot,
  entry: {
    app: appEntry,
    clock: clockEntry,
    retro: retroEntry
  },
  output,
  devtool,
  optimization,
  plugins: pluginArray,
  module: {
    rules: makeRules(!isProduction)
  },
  resolve: {
    fallback: {
      'process/browser': require.resolve('process/browser'),
      events: require.resolve('events/'),
      vm: require.resolve('vm-browserify')
    },
    alias: {
      stream: 'stream-browserify',
      crypto: 'crypto-browserify',
      buffer: 'buffer',
    }
  }
  };
};
