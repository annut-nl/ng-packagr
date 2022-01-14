"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.augmentProgramWithVersioning = exports.cacheCompilerHost = void 0;
const ts = require("typescript");
const path = require("path");
const path_1 = require("../utils/path");
const nodes_1 = require("../ng-package/nodes");
const node_1 = require("../graph/node");
const crypto_1 = require("crypto");
function cacheCompilerHost(graph, entryPoint, compilerOptions, moduleResolutionCache, stylesheetProcessor, sourcesFileCache = entryPoint.cache.sourcesFileCache) {
    const compilerHost = ts.createIncrementalCompilerHost(compilerOptions);
    const getNode = (fileName) => {
        const nodeUri = nodes_1.fileUrl(path_1.ensureUnixPath(fileName));
        let node = graph.get(nodeUri);
        if (!node) {
            node = new node_1.Node(nodeUri);
            graph.put(node);
        }
        return node;
    };
    const addDependee = (fileName) => {
        const node = getNode(fileName);
        entryPoint.dependsOn(node);
    };
    return {
        ...compilerHost,
        // ts specific
        fileExists: (fileName) => {
            const cache = sourcesFileCache.getOrCreate(fileName);
            if (cache.exists === undefined) {
                cache.exists = compilerHost.fileExists.call(this, fileName);
            }
            return cache.exists;
        },
        getSourceFile: (fileName, languageVersion) => {
            addDependee(fileName);
            const cache = sourcesFileCache.getOrCreate(fileName);
            if (!cache.sourceFile) {
                cache.sourceFile = compilerHost.getSourceFile.call(this, fileName, languageVersion);
            }
            return cache.sourceFile;
        },
        writeFile: (fileName, data, writeByteOrderMark, onError, sourceFiles) => {
            if (fileName.endsWith('.d.ts')) {
                sourceFiles.forEach(source => {
                    const cache = sourcesFileCache.getOrCreate(source.fileName);
                    if (!cache.declarationFileName) {
                        cache.declarationFileName = path_1.ensureUnixPath(fileName);
                    }
                });
            }
            compilerHost.writeFile.call(this, fileName, data, writeByteOrderMark, onError, sourceFiles);
        },
        readFile: (fileName) => {
            addDependee(fileName);
            const cache = sourcesFileCache.getOrCreate(fileName);
            if (cache.content === undefined) {
                cache.content = compilerHost.readFile.call(this, fileName);
            }
            return cache.content;
        },
        resolveModuleNames: (moduleNames, containingFile) => {
            return moduleNames.map(moduleName => {
                const { resolvedModule } = ts.resolveModuleName(moduleName, path_1.ensureUnixPath(containingFile), compilerOptions, compilerHost, moduleResolutionCache);
                return resolvedModule;
            });
        },
        resourceNameToFileName: (resourceName, containingFilePath) => {
            const resourcePath = path.resolve(path.dirname(containingFilePath), resourceName);
            const containingNode = getNode(containingFilePath);
            const resourceNode = getNode(resourcePath);
            containingNode.dependsOn(resourceNode);
            return resourcePath;
        },
        readResource: async (fileName) => {
            addDependee(fileName);
            const cache = sourcesFileCache.getOrCreate(fileName);
            if (cache.content === undefined) {
                if (/(?:html?|svg)$/.test(path.extname(fileName))) {
                    // template
                    cache.content = compilerHost.readFile.call(this, fileName);
                }
                else {
                    // stylesheet
                    cache.content = await stylesheetProcessor.process(fileName);
                }
                if (cache.content === undefined) {
                    throw new Error(`Cannot read file ${fileName}.`);
                }
                ;
                cache.exists = true;
            }
            return cache.content;
        },
    };
}
exports.cacheCompilerHost = cacheCompilerHost;
function augmentProgramWithVersioning(program) {
    const baseGetSourceFiles = program.getSourceFiles;
    program.getSourceFiles = function (...parameters) {
        const files = baseGetSourceFiles(...parameters);
        for (const file of files) {
            if (file.version === undefined) {
                file.version = crypto_1.createHash('sha256').update(file.text).digest('hex');
            }
        }
        return files;
    };
}
exports.augmentProgramWithVersioning = augmentProgramWithVersioning;
//# sourceMappingURL=cache-compiler-host.js.map