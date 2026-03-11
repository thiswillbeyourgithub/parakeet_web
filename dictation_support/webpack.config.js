/* eslint-disable no-undef */
/* eslint-disable @typescript-eslint/no-var-requires */
/**
 * @license
 * Copyright 2022 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const HtmlWebpackPlugin = require('html-webpack-plugin');
const path = require('path');
const TerserPlugin = require('terser-webpack-plugin');
const DtsBundlePlugin = require('dts-bundle-webpack');
const libraryName = 'DictationSupport';

module.exports = {
  entry: './src/index.ts',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'index.js',
    library: libraryName,
    libraryTarget: 'umd',
    umdNamedDefine: true,
  },
  resolve : {extensions : ['.ts']},
  devtool : 'source-map',
  optimization : {
    minimize : true,
    minimizer : [new TerserPlugin()],
  },
  module : {
    rules :
          [
            {
              test : /\.ts?$/,
              use : 'ts-loader',
              exclude : /node_modules/,
            },
          ],
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: path.resolve(__dirname, 'example/index.ejs'),
      inject: 'head',
    }),
    new DtsBundlePlugin({
      name: libraryName,
      main: 'dist/out-tsc/index.d.ts',
      out: '../index.d.ts',
      removeSource: true,
      outputAsModuleFolder: true, // to use npm in-package typings
    }),
  ],
};
 