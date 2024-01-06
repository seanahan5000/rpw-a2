//@ts-check

'use strict';

const path = require('path');

/**@type {import('webpack').Configuration}*/

const extConfig = {
    target: 'node',
    entry: './src/extension.ts',
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
                        compilerOptions: {
                            "module": "es6"
                        }
                    }
                }]
            },
            {
                test: /\.css$/i,
                use: [{ loader: 'css-loader' }]
            },
            {
                test: /\.(png|svg|jpg|jpeg|gif|ttf)$/i,
                type: 'asset/resource'
            }
        ]
    }
}

const webConfig = {
    target: ["web"],
    entry: './src/webview/main.ts',
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
                test: /\.css$/i,
                use: [{ loader: 'css-loader' }]
            },
            {
                test: /\.(png|svg|jpg|jpeg|gif|ttf)$/i,
                type: 'asset/resource'
            }
        ]
    }
}

module.exports = [ webConfig, extConfig ];
