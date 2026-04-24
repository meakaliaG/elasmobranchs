const path = require('path');

module.exports = {
    entry: {
        viewer: './client/pages/viewer.jsx',
        nav: './client/pages/nav.jsx',
        // Uncomment as you add more pages:
        // login:     './client/pages/login.jsx',
        // dashboard: './client/pages/dashboard.jsx',
    },
    module: {
        rules: [
            {
                test: /\.(js|jsx)$/,
                exclude: /node_modules/,
                use: {
                    loader: 'babel-loader',
                    options: {
                        presets: [
                            '@babel/preset-env',
                            '@babel/preset-react',
                        ],
                    },
                },
            },
        ],
    },
    resolve: {
        extensions: ['.js', '.jsx'],
    },
    mode: 'production',
    watchOptions: {
        aggregateTimeout: 200,
    },
    output: {
        path: path.resolve(__dirname, 'hosted'),
        filename: '[name]Bundle.js',   // → hosted/viewerBundle.js
    },
};
