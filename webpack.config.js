//@ts-check

'use strict';

const path = require('path');

const CopyWebpackPlugin = require('copy-webpack-plugin');

/**@type {import('webpack').Configuration}*/

const extConfig = {
    target: 'node',
    entry: './src/extension/extension.ts',
    output: {
        path: path.resolve(__dirname, 'out'),
        filename: 'extension.js',
        libraryTarget: "commonjs2",
        devtoolModuleFilenameTemplate: "../[resource-path]"
    },
    devtool: 'source-map',
    externals: {
        vscode: "commonjs vscode"
    },
    resolve: {
        extensions: ['.ts', '.js']
    },
    module: {
        rules: [
            {
                test: /\.ts$/,
                exclude: /node_modules/,
                use: [{
                    loader: 'ts-loader',
                    options: {
                        configFile: 'tsconfig.json'
                    }
                }]
            },
            {
                test: /\.(png|svg|jpg|jpeg|gif|ttf)$/i,
                type: 'asset/resource'
            }
        ]
    },
    plugins: [
        new CopyWebpackPlugin({
            patterns: [
                { from: 'src/display/display_view.css' },
                { from: 'src/machine/apple_view.css' },
                { from: 'src/data_viewers.css' }
            ]
        })
    ]
}

const webConfig = {
    target: ["web"],
    entry: './src/extension/webview.ts',
    output: {
        path: path.resolve(__dirname, 'out'),
        filename: 'webview.js'
    },
    devtool: 'source-map',
    resolve: {
        extensions: ['.ts', '.js']
    },
    module: {
        rules: [
            {
                test: /\.ts$/,
                exclude: /node_modules/,
                use: [{ loader: 'ts-loader' }]
            },
            {
                test: /\.(png|svg|jpg|jpeg|gif|ttf)$/i,
                type: 'asset/resource'
            }
        ]
    }
}

module.exports = [ webConfig, extConfig ];
