"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.compileSourceFiles = void 0;
const ng = require("@angular/compiler-cli");
const api_1 = require("@angular/compiler-cli/src/ngtsc/typecheck/api");
const program_1 = require("@angular/compiler-cli/src/ngtsc/program");
const ts = require("typescript");
const log = require("../utils/log");
const cache_compiler_host_1 = require("./cache-compiler-host");
const nodes_1 = require("../ng-package/nodes");
const ngcc_transform_compiler_host_1 = require("../ts/ngcc-transform-compiler-host");
async function compileSourceFiles(graph, tsConfig, moduleResolutionCache, extraOptions, stylesheetProcessor, ngccProcessor, watch) {
    log.debug(`ngc (v${ng.VERSION.full})`);
    const tsConfigOptions = { ...tsConfig.options, ...extraOptions };
    const entryPoint = graph.find(nodes_1.isEntryPointInProgress());
    const tsCompilerHost = ngcc_transform_compiler_host_1.ngccTransformCompilerHost(cache_compiler_host_1.cacheCompilerHost(graph, entryPoint, tsConfigOptions, moduleResolutionCache, stylesheetProcessor), tsConfigOptions, ngccProcessor, moduleResolutionCache);
    const cache = entryPoint.cache;
    const sourceFileCache = cache.sourcesFileCache;
    // Create the Angular specific program that contains the Angular compiler
    const angularProgram = new program_1.NgtscProgram(tsConfig.rootNames, tsConfigOptions, tsCompilerHost, cache.oldNgtscProgram);
    const angularCompiler = angularProgram.compiler;
    const { ignoreForDiagnostics, ignoreForEmit } = angularCompiler;
    // SourceFile versions are required for builder programs.
    // The wrapped host inside NgtscProgram adds additional files that will not have versions.
    const typeScriptProgram = angularProgram.getTsProgram();
    cache_compiler_host_1.augmentProgramWithVersioning(typeScriptProgram);
    let builder;
    if (watch) {
        builder = cache.oldBuilder = ts.createEmitAndSemanticDiagnosticsBuilderProgram(typeScriptProgram, tsCompilerHost, cache.oldBuilder);
        cache.oldNgtscProgram = angularProgram;
    }
    else {
        // When not in watch mode, the startup cost of the incremental analysis can be avoided by
        // using an abstract builder that only wraps a TypeScript program.
        builder = ts.createAbstractBuilder(typeScriptProgram, tsCompilerHost);
    }
    // Update semantic diagnostics cache
    const affectedFiles = new Set();
    // Analyze affected files when in watch mode for incremental type checking
    if ('getSemanticDiagnosticsOfNextAffectedFile' in builder) {
        while (true) {
            const result = builder.getSemanticDiagnosticsOfNextAffectedFile(undefined, sourceFile => {
                // If the affected file is a TTC shim, add the shim's original source file.
                // This ensures that changes that affect TTC are typechecked even when the changes
                // are otherwise unrelated from a TS perspective and do not result in Ivy codegen changes.
                // For example, changing @Input property types of a directive used in another component's
                // template.
                if (ignoreForDiagnostics.has(sourceFile) && sourceFile.fileName.endsWith('.ngtypecheck.ts')) {
                    // This file name conversion relies on internal compiler logic and should be converted
                    // to an official method when available. 15 is length of `.ngtypecheck.ts`
                    const originalFilename = sourceFile.fileName.slice(0, -15) + '.ts';
                    const originalSourceFile = builder.getSourceFile(originalFilename);
                    if (originalSourceFile) {
                        affectedFiles.add(originalSourceFile);
                    }
                    return true;
                }
                return false;
            });
            if (!result) {
                break;
            }
            affectedFiles.add(result.affected);
        }
    }
    // Collect program level diagnostics
    const allDiagnostics = [
        ...angularCompiler.getOptionDiagnostics(),
        ...builder.getOptionsDiagnostics(),
        ...builder.getGlobalDiagnostics(),
    ];
    // Required to support asynchronous resource loading
    // Must be done before creating transformers or getting template diagnostics
    await angularCompiler.analyzeAsync();
    // Collect source file specific diagnostics
    for (const sourceFile of builder.getSourceFiles()) {
        if (!ignoreForDiagnostics.has(sourceFile)) {
            allDiagnostics.push(...builder.getSyntacticDiagnostics(sourceFile), ...builder.getSemanticDiagnostics(sourceFile));
        }
        if (sourceFile.isDeclarationFile) {
            continue;
        }
        // Collect sources that are required to be emitted
        if (!ignoreForEmit.has(sourceFile) && !angularCompiler.incrementalDriver.safeToSkipEmit(sourceFile)) {
            // If required to emit, diagnostics may have also changed
            if (!ignoreForDiagnostics.has(sourceFile)) {
                affectedFiles.add(sourceFile);
            }
        }
        else if (sourceFileCache && !affectedFiles.has(sourceFile) && !ignoreForDiagnostics.has(sourceFile)) {
            // Use cached Angular diagnostics for unchanged and unaffected files
            const angularDiagnostics = sourceFileCache.getAngularDiagnostics(sourceFile);
            if (angularDiagnostics === null || angularDiagnostics === void 0 ? void 0 : angularDiagnostics.length) {
                allDiagnostics.push(...angularDiagnostics);
            }
        }
    }
    // Collect new Angular diagnostics for files affected by changes
    for (const affectedFile of affectedFiles) {
        const angularDiagnostics = angularCompiler.getDiagnosticsForFile(affectedFile, api_1.OptimizeFor.WholeProgram);
        allDiagnostics.push(...angularDiagnostics);
        sourceFileCache.updateAngularDiagnostics(affectedFile, angularDiagnostics);
    }
    // if we have an error we don't want to transpile.
    const exitCode = ng.exitCodeFromResult(allDiagnostics);
    const formattedDiagnostics = ng.formatDiagnostics(allDiagnostics);
    if (exitCode === 0) {
        if (formattedDiagnostics.length) {
            log.msg(formattedDiagnostics);
        }
        const transformers = angularCompiler.prepareEmit().transformers;
        for (const sourceFile of builder.getSourceFiles()) {
            if (!ignoreForEmit.has(sourceFile)) {
                builder.emit(sourceFile, undefined, undefined, undefined, transformers);
            }
        }
    }
    else {
        throw new Error(formattedDiagnostics);
    }
}
exports.compileSourceFiles = compileSourceFiles;
//# sourceMappingURL=compile-source-files.js.map