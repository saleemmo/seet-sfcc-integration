'use strict';

const path = require('path');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const RemoveEmptyScriptsPlugin = require('webpack-remove-empty-scripts');
const sgmfScripts = require('sgmf-scripts');

const cartridgeName = require('./package.json').packageName;
const outputPath = path.resolve(__dirname, `cartridges/${cartridgeName}/cartridge/static`);

module.exports = [
    {
        mode: 'production',
        name: 'js',
        entry: sgmfScripts.createJsPath(),
        output: {
            path: outputPath,
            filename: '[name].js'
        },
        devtool: false
    },
    {
        mode: 'production',
        name: 'scss',
        entry: sgmfScripts.createScssPath(),
        output: {
            path: outputPath
        },
        module: {
            rules: [
                {
                    test: /\.scss$/,
                    use: [
                        MiniCssExtractPlugin.loader,
                        { loader: 'css-loader', options: { url: false } },
                        {
                            loader: 'postcss-loader',
                            options: { postcssOptions: { plugins: [require('autoprefixer')] } }
                        },
                        { loader: 'sass-loader', options: { implementation: require('sass') } }
                    ]
                }
            ]
        },
        plugins: [
            new RemoveEmptyScriptsPlugin(),
            new MiniCssExtractPlugin({ filename: '[name].css' })
        ]
    }
];
