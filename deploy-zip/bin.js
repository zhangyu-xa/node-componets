#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');
const DeployTools = require('./index.js');


const configFilePath = path.resolve(process.cwd(), 'deploy.config.js');
const usingDynamicImport = false;

const dynamicImport = usingDynamicImport
    ? new Function('file', 'return import(file)')
    : require;

async function bundleConfigFile(fileName, isESM = false) {
    const result = await esbuild.build({
        absWorkingDir: process.cwd(),
        entryPoints: [fileName],
        outfile: 'out.js',
        write: false,
        platform: 'node',
        bundle: true,
        format: isESM ? 'esm' : 'cjs',
        sourcemap: 'inline',
        metafile: true,
        plugins: [
            {
                name: 'externalize-deps',
                setup(build) {
                    build.onResolve({ filter: /.*/ }, (args) => {
                        const id = args.path;
                        if (id[0] !== '.' && !path.isAbsolute(id)) {
                            return {
                                external: true
                            };
                        }
                    });
                }
            },
            {
                name: 'replace-import-meta',
                setup(build) {
                    build.onLoad({ filter: /\.[jt]s$/ }, async (args) => {
                        const contents = await fs.promises.readFile(args.path, 'utf8');
                        return {
                            loader: args.path.endsWith('.ts') ? 'ts' : 'js',
                            contents: contents
                                .replace(/\bimport\.meta\.url\b/g, JSON.stringify(`file://${args.path}`))
                                .replace(/\b__dirname\b/g, JSON.stringify(path.dirname(args.path)))
                                .replace(/\b__filename\b/g, JSON.stringify(args.path))
                        };
                    });
                }
            }
        ]
    });
    const { text } = result.outputFiles[0];
    return {
        code: text,
        dependencies: result.metafile ? Object.keys(result.metafile.inputs) : []
    };
}
async function loadConfigFromBundledFile(fileName, bundledCode) {
    const extension = path.extname(fileName);
    const defaultLoader = require.extensions[extension];
    require.extensions[extension] = (module, filename) => {
        if (filename === fileName) {
            module._compile(bundledCode, filename);
        }
        else {
            defaultLoader(module, filename);
        }
    };
    // clear cache in case of server restart
    delete require.cache[require.resolve(fileName)];
    const raw = require(fileName);
    const config = raw.__esModule ? raw.default : raw;
    require.extensions[extension] = defaultLoader;
    return config;
}

// esm
async function loadFileByEsbuild(configFilePath) {
    const bundled = await bundleConfigFile(configFilePath);
    return await loadConfigFromBundledFile(configFilePath, bundled.code);
}

// cjs
async function loadFileByImport(configFilePath) {
    const configFileUrl = require('url').pathToFileURL(configFilePath);
    return (await dynamicImport(configFileUrl)).default;
}

// cjs
async function loadFileByRequire(configFilePath) {
    return await dynamicImport(configFilePath);
}

(async function() {
    const config = await loadFileByEsbuild(configFilePath);
    DeployTools.init(config).start();
})();

