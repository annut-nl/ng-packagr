"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StylesheetProcessor = exports.CssUrl = void 0;
const browserslist = require("browserslist");
const findCacheDirectory = require("find-cache-dir");
const os_1 = require("os");
const cacache = require("cacache");
const postcss_1 = require("postcss");
const postcssUrl = require("postcss-url");
const cssnano = require("cssnano");
const postcssPresetEnv = require("postcss-preset-env");
const log = require("../../utils/log");
const fs_1 = require("../../utils/fs");
const crypto_1 = require("crypto");
const path_1 = require("path");
const findUp = require("find-up");
const postcssLoadConfig = require("postcss-load-config");
var CssUrl;
(function (CssUrl) {
    CssUrl["inline"] = "inline";
    CssUrl["none"] = "none";
})(CssUrl = exports.CssUrl || (exports.CssUrl = {}));
const cachePath = findCacheDirectory({ name: 'ng-packagr-styles' }) || os_1.tmpdir();
let ngPackagrVersion;
try {
    ngPackagrVersion = require('../../../package.json').version;
}
catch {
    // dev path
    ngPackagrVersion = require('../../../../package.json').version;
}
class StylesheetProcessor {
    constructor(basePath, cssUrl, styleIncludePaths) {
        this.basePath = basePath;
        this.cssUrl = cssUrl;
        this.styleIncludePaths = styleIncludePaths;
        log.debug(`determine browserslist for ${this.basePath}`);
        this.browserslistData = browserslist(undefined, { path: this.basePath });
        this.postCssProcessor = this.createPostCssPlugins();
    }
    async process(filePath) {
        const content = await fs_1.readFile(filePath, 'utf8');
        let key;
        if (!content.includes('@import') && !content.includes('@use')) {
            // No transitive deps, we can cache more aggressively.
            key = generateKey(content, this.browserslistData);
            const result = await readCacheEntry(cachePath, key);
            if (result) {
                result.warnings.forEach(msg => log.warn(msg));
                return result.css;
            }
        }
        // Render pre-processor language (sass, styl, less)
        const renderedCss = await this.renderCss(filePath, content);
        // We cannot cache CSS re-rendering phase, because a transitive dependency via (@import) can case different CSS output.
        // Example a change in a mixin or SCSS variable.
        if (!key) {
            key = generateKey(renderedCss, this.browserslistData);
        }
        const cachedResult = await readCacheEntry(cachePath, key);
        if (cachedResult) {
            cachedResult.warnings.forEach(msg => log.warn(msg));
            return cachedResult.css;
        }
        // Render postcss (autoprefixing and friends)
        const result = await this.postCssProcessor.process(renderedCss, {
            from: filePath,
            to: filePath.replace(path_1.extname(filePath), '.css'),
        });
        const warnings = result.warnings().map(w => w.toString());
        // Add to cache
        await cacache.put(cachePath, key, JSON.stringify({
            css: result.css,
            warnings,
        }));
        warnings.forEach(msg => log.warn(msg));
        return result.css;
    }
    createPostCssPlugins() {
        const postCssPlugins = [];
        if (this.cssUrl !== CssUrl.none) {
            postCssPlugins.push(postcssUrl({ url: this.cssUrl }));
        }
        const postcssConfigFiles = ['.postcssrc.json', '.postcssrc.js', 'postcss.config.js'];
        const customPostcssConfig = findUp.sync(postcssConfigFiles);
        try {
            const postcssConfig = require(customPostcssConfig);
            const { plugins } = postcssLoadConfig.sync(postcssConfig);
            plugins.forEach(plugin => {
                postCssPlugins.push(plugin);
            });
        }
        catch (error) {
            if (error.code !== 'MODULE_NOT_FOUND') {
                throw error;
            }
        }
        postCssPlugins.push(postcssPresetEnv({
            browsers: this.browserslistData,
            autoprefixer: true,
            stage: 3,
        }), cssnano({
            preset: [
                'default',
                {
                    // Disable SVG optimizations, as this can cause optimizations which are not compatible in all browsers.
                    svgo: false,
                    // Disable `calc` optimizations, due to several issues. #16910, #16875, #17890
                    calc: false,
                    // Disable CSS rules sorted due to several issues #20693, https://github.com/ionic-team/ionic-framework/issues/23266 and https://github.com/cssnano/cssnano/issues/1054
                    cssDeclarationSorter: false,
                },
            ],
        }));
        return postcss_1.default(postCssPlugins);
    }
    async renderCss(filePath, css) {
        const ext = path_1.extname(filePath);
        switch (ext) {
            case '.sass':
            case '.scss': {
                /*
                 * Please be aware of the few differences in behaviour https://github.com/sass/dart-sass/blob/master/README.md#behavioral-differences-from-ruby-sass
                 * By default `npm install` will install sass.
                 * To use node-sass you need to use:
                 *   Npm:
                 *     `npm install node-sass --save-dev`
                 *   Yarn:
                 *     `yarn add node-sass --dev`
                 */
                let sassCompiler;
                try {
                    sassCompiler = require('node-sass'); // Check if node-sass is explicitly included.
                }
                catch {
                    sassCompiler = await Promise.resolve().then(() => require('sass'));
                }
                return sassCompiler
                    .renderSync({
                    file: filePath,
                    data: css,
                    indentedSyntax: '.sass' === ext,
                    importer: await Promise.resolve().then(() => require('node-sass-tilde-importer')),
                    includePaths: this.styleIncludePaths,
                })
                    .css.toString();
            }
            case '.less': {
                const { css: content } = await (await Promise.resolve().then(() => require('less'))).render(css, {
                    filename: filePath,
                    javascriptEnabled: true,
                    paths: this.styleIncludePaths,
                });
                return content;
            }
            case '.styl':
            case '.stylus': {
                const stylus = await Promise.resolve().then(() => require('stylus'));
                return (stylus(css)
                    // add paths for resolve
                    .set('paths', [this.basePath, '.', ...this.styleIncludePaths, 'node_modules'])
                    // add support for resolving plugins from node_modules
                    .set('filename', filePath)
                    // turn on url resolver in stylus, same as flag --resolve-url
                    .set('resolve url', true)
                    .define('url', stylus.resolver(undefined))
                    .render());
            }
            case '.css':
            default:
                return css;
        }
    }
}
exports.StylesheetProcessor = StylesheetProcessor;
function generateKey(content, browserslistData) {
    return crypto_1.createHash('sha1').update(ngPackagrVersion).update(content).update(browserslistData.join('')).digest('base64');
}
async function readCacheEntry(cachePath, key) {
    const entry = await cacache.get.info(cachePath, key);
    if (entry) {
        return JSON.parse(await fs_1.readFile(entry.path, 'utf8'));
    }
    return undefined;
}
//# sourceMappingURL=stylesheet-processor.js.map