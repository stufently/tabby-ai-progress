const path = require('path')

module.exports = {
    entry: './src/index.ts',
    module: { rules: [
        { test: /\.ts$/, loader: 'ts-loader', options: { configFile: path.resolve(__dirname, 'tsconfig.json') } },
        { test: /\.pug$/, use: ['apply-loader', 'pug-loader'] },
    ] },
    resolve: { extensions: ['.ts', '.js'] },
    externals: ['fs', 'os', 'path', 'ngx-toastr', /^rxjs/, /^@angular/, /^@ng-bootstrap/, /^tabby-/],
    output: {
        path: path.resolve(__dirname, 'dist'),
        filename: 'index.js',
        libraryTarget: 'umd',
        globalObject: 'this',
    },
}
