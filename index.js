"use strict";

var Fs = require('fs'),
    Path = require('path'),
    UglifyJS = require('uglify-js');

/**
 * Checks if a path exists and is a file (not a directory), without throwing any error
 * @param {String} path
 * @returns {Boolean}
 */
var isFileSync = function (path) {
    var stat = null;
    try {
        stat = Fs.statSync(path);
    } catch (e) {

    }
    return !!stat && stat.isFile();
};

/**
 * Checks if a path exists and is directory, without throwing any error
 * @param {String} path
 * @returns {Boolean}
 */
var isDirectorySync = function (path) {
    var stat = null;
    try {
        stat = Fs.statSync(path);
    } catch (e) {

    }
    return !!stat && stat.isDirectory();
};

/**
 * @const
 */
var CORE_MODULE_LIST = (function () {
    var core = {};
    ['assert', 'buffer', 'child_process', 'cluster',
        'crypto', 'dgram', 'dns', 'events', 'fs', 'http', 'https', 'net',
        'os', 'path', 'punycode', 'querystring', 'readline', 'repl',
        'string_decoder', 'tls', 'tty', 'url', 'util', 'vm', 'zlib'].forEach(function (key) {
            core[key] = true;
        });
    return core;
})();

/**
 * @constructor
 * @param options
 */
var optimizer = function (options) {

    this.options = {
        ignore: (options ? options.ignore || options.ignoreRequired : null) || [],
        include: (options ? options.include : null) || []
    };

};

/**
 * Resolves a path relative to another path
 * I.e. what is the meaning of Y in `require(Y)` when called within a specific module?
 * @param {String} from - base path
 * @param {String} to - relative path to normalize
 * @returns {String}
 */
var resolveRelativePath = function (from, to) {

    var relPath = Path.relative(from, to);
    if (!/^[\./\\]/.test(relPath) && !/:\//.test(relPath)) {
        relPath = './' + relPath;
    }

    // Normalize path if possible
    if (relPath.indexOf(':') === -1) {
        relPath = relPath.replace(/\\/g, '/');
    }

    return relPath;

};

/**
 * Enumerate files in `rootDir`, using `filters`
 * @param {String} rootDir
 * @param {String} filters
 * @returns {Array.<String>} array of absolute paths
 */
var getMatchingFilesSync = function(rootDir, filters) {
    var results = [];

    filters.forEach(function (filter) {
        var destination = Path.resolve(rootDir, filter),
            file = null;

        try {
            file = Fs.lstatSync(destination);
        } catch (e) {
        }

        if (file && file.isDirectory()) {
            Fs.readdirSync(destination).reduce((function(prev, curr) {
                prev.push(Path.join(destination, curr));
                return prev;
            }), results);
        } else {
            if (Path.extname(destination) === '') {
                var fileName = Path.basename(destination);
                Fs.readdirSync(Path.dirname(destination)).filter(function(fileNameLoc) {
                    return fileNameLoc.indexOf(fileName) !== -1;
                }).reduce((function(prev, curr) {
                    prev.push(Path.join(destination, curr));
                    return prev;
                }), results);
            } else {
                results.push(destination);
            }
        }
    });

    return results;

};

/**
 * Performs a `JSON.parse(...)` on `data`, without throwing an exception
 * @param {String?} data
 * @returns {*} the parsed data, or null if failed
 */
var tryJsonParse = function (data) {
  try {
      return JSON.parse(data);
  } catch (e) {
      return null;
  }
};

/**
 * Searches for all `require` statements inside `sourceCode`, and returns a normalized set of data about it
 * @param {String} sourceCode - the source code body of the file being investigated
 * @param {String} filePath - path of the file being investigated
 * @returns {Array.<{statement: String, statementArguments: String, text: String, path: String}>}
 */
var getRequireStatements = function(sourceCode, filePath) {

    // Replace newlines in the same way that UglifyJS does
    // So we'll have correct `pos` properties

    sourceCode = sourceCode.replace(/\r\n?|[\n\u2028\u2029]/g, "\n").replace(/\uFEFF/g, '');
    var ast = UglifyJS.parse(sourceCode);

    var results = [];
    var MODULE_PATH_Y = Path.dirname(filePath);

    var processRequireNode = function(originalText, text, args) {
        if (args.length !== 1) {
            return 'unknown';
        }

        var CREATE_RESULT = function (path, type) {
            var result = {
                statement: originalText,
                statementArguments: originalText.match(/^require\s*\(([\s\S]*)\)/)[1],
                text: tryJsonParse(text),
                path: path,
                type: type
            };
            results.push(result);
            return result;
        };

        /**
         * Implements the LOAD_AS_FILE function
         * @param {String} X - the path
         * @returns {Boolean|String} `true` if processed and fine, `false` if not found, 'node' if it's a binary module
         */
        var LOAD_AS_FILE = function (X) {

            // 1. If X is a file, load X as JavaScript text.  STOP
            if (isFileSync(X)) {
                CREATE_RESULT(X, 'js');
                return true;
            }

            // 2. If X.js is a file, load X.js as JavaScript text.  STOP
            if (isFileSync(X + '.js')) {
                CREATE_RESULT(X + '.js', 'js');
                return true;
            }

            // 3. If X.json is a file, parse X.json to a JavaScript Object.  STOP
            if (isFileSync(X + '.json')) {
                CREATE_RESULT(X + '.json', 'json');
                return true;
            }

            // 4. If X.node is a file, load X.node as binary addon.  STOP
            if (isFileSync(X + '.node')) {
                return 'node';
            }

            return false;
        };

        /**
         * Implements the LOAD_AS_DIRECTORY function
         * @param {String} X - the path
         * @returns {Boolean|String} `true` if processed and fine, `false` if not found, 'node' if it's a binary module
         */
        var LOAD_AS_DIRECTORY = function (X) {

            if (!isDirectorySync(X)) return false;

            // 1. If X/package.json is a file,
            var packageJson = null;
            try {
                // 1. a. Parse X/package.json, and look for "main" field.
                packageJson = JSON.parse(Fs.readFileSync(Path.join(X, 'package.json'), { encoding: 'utf8' }).toString());
            } catch (e) {

            }

            if (packageJson && packageJson.main) {
                // 1. b. let M = X + (json main field)
                var M = Path.join(X, packageJson.main);

                // 1. c. LOAD_AS_FILE(M)
                var loadedAsFile = LOAD_AS_FILE(M);
                if (loadedAsFile) {
                    return loadedAsFile;
                }
            }

            // 2. If X/index.js is a file, load X/index.js as JavaScript text.  STOP
            if (isFileSync(Path.join(X, 'index.js'))) {
                CREATE_RESULT(Path.join(X, 'index.js'), 'js');
                return true;
            }

            // 3. If X/index.json is a file, parse X/index.json to a JavaScript object. STOP
            if (isFileSync(Path.join(X, 'index.json'))) {
                CREATE_RESULT(Path.join(X, 'index.json'), 'json');
                return true;
            }

            // 4. If X/index.node is a file, load X/index.node as binary addon.  STOP
            if (isFileSync(Path.join(X, 'index.node'))) {
                return 'node';
            }

            return false;
        };

        // require(X) from module at path Y
        var REQUIRE_X = args[0].value;

        if (REQUIRE_X) {

            // 1. If X is a core module
            if (CORE_MODULE_LIST.hasOwnProperty(REQUIRE_X)) {
                return 'core';
            }

            // 2. If X begins with './' or '/' or '../' (Windows: OR [DRIVE LETTER]:/ OR [DRIVE LETTER]:\)
            if (/^(\.{0,2}[/\\]|[a-zA-Z]:)/.test(REQUIRE_X)) {
                return LOAD_AS_FILE(Path.resolve(MODULE_PATH_Y, REQUIRE_X)) /* 2. a. LOAD_AS_FILE(Y + X) */
                    || LOAD_AS_DIRECTORY(Path.resolve(MODULE_PATH_Y, REQUIRE_X)); /* 2. b. LOAD_AS_DIRECTORY(Y + X) */
            }

            // 3. LOAD_NODE_MODULES(X, dirname(Y))
            // We ignore node_modules, as it makes no sense.
            // They will most probably contain binaries, and will probably benefit from `npm update`s...

            // 4. THROW "not found"
            return 'not-exists';
        } else {

            // The expression inside the `require` is too complex, we can't parse it.

            CREATE_RESULT(REQUIRE_X, 'complex');

            return 'complex';
        }
    };

    ast.walk(new UglifyJS.TreeWalker(function(node) {

        if (node instanceof UglifyJS.AST_Call) {

            while (/\brequire\b/.test(node.print_to_string()) && node.expression && node.expression.print_to_string() !== 'require') {
                node = node.expression;
            }

            if (node.expression && node.expression.print_to_string() === 'require') {

                var originalText = sourceCode.substring(node.start.pos, node.end.pos + 1);
                var text = node.print_to_string({ beautify: false });

                var ret = processRequireNode(originalText, text, node.args);

                if (ret !== true &&
                    ret !== 'core' &&
                    ret !== 'node' &&
                    ret !== 'not-exists') {

                    console.log('Ignoring complex require statement in:\n' +
                    '  file      : ' + filePath + '\n' +
                    '  statement : ' + originalText + '\n' +
                    '  You may want to add that file to options.include.');
                }

                return true;

            }
        }
    }));

    return results;
};

var regexEscapePattern = /[-\/()[\]?{}|*+\\:\.$^#|]/g;
var regexEscape = function (string) {
    return string.replace(regexEscapePattern, "\\$&");
};

/**
 * Do the actual optimization process
 * @param {String} mainFilePath - path for the main file of the project
 * @returns {string} optimized project file
 */
optimizer.prototype.merge = function(mainFilePath) {

    mainFilePath = Path.resolve(mainFilePath) || Path.resolve(process.cwd(), mainFilePath);
    var rootDir = Fs.lstatSync(mainFilePath).isDirectory() ? Path.resolve(mainFilePath) : Path.dirname(Path.resolve(mainFilePath));
    rootDir += /\\/.test(Path.resolve('/path/to')) ? '\\' : '/';

    if (!isFileSync(mainFilePath)) {
        throw new Error("Main file not found " + mainFilePath);
    }

    var filteredOutFiles = getMatchingFilesSync(rootDir, this.options.ignore);
    var includedFiles = getMatchingFilesSync(rootDir, this.options.include);

    var requiredMap = {};

    var requireFileMode = function (filePath) {

        // This is a complex `required` statement which is not a simple script, leave that to runtime
        if (filePath === false) return 'complex';

        // These will surely be included
        if (includedFiles.filter(function(filter) {
                return Path.normalize(filter) === Path.normalize(filePath);
            }).length > 0) return true;

        // These will be excluded, but we know that we still need to normalize paths of require to those
        if (filteredOutFiles.filter(function(filter) {
                return Path.normalize(filter) === Path.normalize(filePath);
            }).length > 0) return 'normalize_path';

        // These are not in the scope of the project, and should not be included
        if (filePath.substr(0, rootDir.length).toLowerCase() !== rootDir.toLowerCase()) {
            return false;
        }

        // Now we only need the path without the project dir prefix
        filePath = filePath.substr(rootDir.length);

        // The file is in node_modules under current project - exclude
        if (/^node_modules$|\/node_modules$|^node_modules\/|\\node_modules$|^node_modules\\/.test(filePath)) {
            return false;
        }

        return true;
    };

    var recursiveSourceGrabber = function(filePath) {

        if (requiredMap.hasOwnProperty(filePath)) return;

        var required = {};

        var sourceCode = required.source = Fs.readFileSync(filePath, { encoding: 'utf8' }).toString();
        requiredMap[filePath] = required;

        var requireStatements = getRequireStatements(sourceCode, filePath);

        requireStatements.forEach(function (requireStatement) {
            if (requireStatement.path) {
                requireStatement.path = Path.resolve(filePath, requireStatement.path);
            }
        });

        requireStatements.forEach(function (requireStatement) {
            if (requireStatement.path) {
                requireStatement.mode = requireFileMode(requireStatement.path);
            } else if (requireStatement.type === 'complex') {
                requireStatement.mode = 'complex';
            }
        });

        requireStatements = requireStatements.filter(function (requireStatement) {
            return requireStatement.mode;
        });

        required.required = requireStatements;

        requireStatements.forEach(function (requireStatement) {

            if (requireStatement.mode !== true) return; // Ignore files that do not need to be dealt with deeply

            recursiveSourceGrabber(requireStatement.path);

        });

    };

    // Recurse through the main file
    recursiveSourceGrabber(mainFilePath);

    // Now include any files that were specifically included using options.include
    includedFiles.forEach(function (includedFile) {
        recursiveSourceGrabber(includedFile);
    });

    // Assign module keys and prepare for storing in the 'required' container
    Object.keys(requiredMap).forEach(function (modulePath) {
        if (modulePath === mainFilePath) return;

        var moduleToInline = requiredMap[modulePath];

        // Figure out the relative path of said module, relative to the main file
        moduleToInline.relativePath = resolveRelativePath(rootDir, modulePath);

        if (/\.json$/i.test(moduleToInline.relativePath)) {
            // Generate the json's data to inline later
            moduleToInline.source = '__JSON_LOADER__(' + JSON.stringify(moduleToInline.source) + ')';
        } else {
            // Generate the module's data to inline later
            moduleToInline.source = '\
__MODULE_LOADER__(function(module, exports){\n\n' + moduleToInline.source + '\n\n})';
        }

    });

    // Replace require calls
    Object.keys(requiredMap).forEach(function (modulePath) {
        var moduleToInline = requiredMap[modulePath];
        moduleToInline.required.forEach(function (requiredStatement) {

            if (requiredStatement.mode) {
                /**
                 * In the past we were only normalizing paths of excluded modules,
                 * And replacing `require` calls of included user modules.
                 *
                 * Now we replace all require calls which are not core modules
                 */

                // Prepare a replacing statement
                var regex = regexEscape(requiredStatement.statement);

                if (requiredStatement.text) {
                    var relativePath = resolveRelativePath(mainFilePath, requiredStatement.text);
                    moduleToInline.source = moduleToInline.source.replace(new RegExp(regex), '__FAKE_REQUIRE__(' + JSON.stringify(relativePath) + ')');
                } else {
                    moduleToInline.source = moduleToInline.source.replace(new RegExp(regex), '__FAKE_REQUIRE__(' + requiredStatement.statementArguments + ', ' + JSON.stringify(modulePath) + ')');
                }

            }

        });
    });

    // Prepare this for cases when we do a "soft" lookup (adding .js or .json to pathnames) and pathes differ in case
    // So we simulate the behavior on real FSes with case insensitivity
    // On a case sensitive FS, if node.js looks for MODULEPATH + .js, I do not know if it will find .JS files too.
    var caseInsensitivePathMap = {};
    Object.keys(requiredMap).forEach(function (modulePath) {
        caseInsensitivePathMap[modulePath.toLowerCase()] = modulePath;
    });

    // Start writing the actual output

    var source = '', isFirstRequired;

    // Write "required" wrapper beginning
    // NOTE: It is mandatory that `fakeModule.loaded = true` is done before `moduleLoadFunction`,
    //       in order to supprt cyclic requires.
    source += '\
(function(){ \
    \
    var __CORE_MODULE_LIST__ = ' + JSON.stringify(CORE_MODULE_LIST) + '; \
    \
    var __MODULE_LOADER__ = function (moduleLoadFunction) {\
        var fakeModule = { \
            id: module.id, \
            parent: module.parent, \
            filename: module.filename, \
            loaded: false, \
            children: [], \
            paths: module.paths, \
            exports: {} \
        }; \
        \
        return function () { \
            if (!fakeModule.loaded && !fakeModule.__isLoading) { \
                fakeModule.__isLoading = true; \
                try {\
                  moduleLoadFunction(fakeModule, fakeModule.exports); \
                  fakeModule.__isLoading = false;\
                } catch (e) {\
                  fakeModule.__isLoading = false;\
                  throw e;\
                }\
                fakeModule.loaded = true; \
            } \
            return fakeModule.exports; \
        }; \
    }; \
    \
    var __JSON_LOADER__ = function (json) {\
        return function () { \
            return JSON.parse(json); \
        }; \
    }; \
    \
    var __REQUIRED_NODE_MODULES__ = { \
    ';

    // Write known modules
    isFirstRequired = true;
    Object.keys(requiredMap).forEach(function (modulePath) {
        if (modulePath === mainFilePath) return;

        var moduleToInline = requiredMap[modulePath];

        if (isFirstRequired) isFirstRequired = false;
        else source += ', ';

        source += JSON.stringify(moduleToInline.relativePath) + ': \n' + moduleToInline.source + '\n';
    });

    // Write "required" wrapper end
source += '\
    }; \
    \
    var __CI_MODULE_PATH_MAP__ = { \
    ';

    // Write known modules
    isFirstRequired = true;
    Object.keys(caseInsensitivePathMap).forEach(function (ciPath) {
        if (isFirstRequired) isFirstRequired = false;
        else source += ', ';
        source += JSON.stringify(ciPath) + ': \n' + JSON.stringify(caseInsensitivePathMap[ciPath]) + '\n';
    });

    // Write "required" wrapper end
    source += '\
    }; \
    \
    var Path = require("path");\
    var resolveRelativePath = ' + resolveRelativePath.toString() + '; \
    var __MAIN_ORIGINAL_PATH__ = '  + JSON.stringify(mainFilePath) + ';\
    \
    var __LOOK_FOR_FILE__ = function (relPath) {\
        var module = __REQUIRED_NODE_MODULES__.hasOwnProperty(relPath) ? __REQUIRED_NODE_MODULES__[relPath] : null;\
        if (!module) {\
            relPath = __CI_MODULE_PATH_MAP__[relPath];\
            if (relPath) {\
                module = __REQUIRED_NODE_MODULES__.hasOwnProperty(relPath) ? __REQUIRED_NODE_MODULES__[relPath] : null;\
            }\
        }\
        return module;\
    };\
    \
    var __FAKE_REQUIRE__ = function (modulePath, originalModulePath) {\
        if (!__CORE_MODULE_LIST__.hasOwnProperty(modulePath)) {\
            /* Transform path to distribution path */\
            var relPath;\
            if (originalModulePath) {\
                relPath = Path.resolve(Path.dirname(originalModulePath), modulePath);\
                relPath = resolveRelativePath(Path.dirname(__MAIN_ORIGINAL_PATH__), relPath);\
            } else {\
                relPath = resolveRelativePath(__dirname, modulePath);\
            }\
            \
            /* Try inlined modules */\
            var module = __LOOK_FOR_FILE__(relPath) || __LOOK_FOR_FILE__(relPath + \'.js\') || __LOOK_FOR_FILE__(relPath + \'.json\');\
            if (module) return module();\
            \
            /* Try original `require` with transformed path */\
            try {\
                return require(relPath);\
            } catch (e) {\
            }\
        }\
        \
        /* Try original `require` with original statement */\
        return require(modulePath);\
    };\
    \
    this.__FAKE_REQUIRE__ = __FAKE_REQUIRE__; \
    \
})();';

    // Write main file source
    source += requiredMap[mainFilePath].source;

    console.log('Optimized node project starting with ' + mainFilePath);

    return source;
};

module.exports = optimizer;


/**
 Node's require algorithm:

 require(X) from module at path Y
 1. If X is a core module, (IN: module.exports._builtinLibs)
 1. a. return the core module
 1. b. STOP
 2. If X begins with './' or '/' or '../' (Windows: OR [DRIVE LETTER]:/ OR [DRIVE LETTER]:\)
 2. a. LOAD_AS_FILE(Y + X)
 2. b. LOAD_AS_DIRECTORY(Y + X)
 3. LOAD_NODE_MODULES(X, dirname(Y))
 4. THROW "not found"

 LOAD_AS_FILE(X)
 1. If X is a file, load X as JavaScript text.  STOP
 2. If X.js is a file, load X.js as JavaScript text.  STOP
 3. If X.json is a file, parse X.json to a JavaScript Object.  STOP
 4. If X.node is a file, load X.node as binary addon.  STOP

 LOAD_AS_DIRECTORY(X)
 1. If X/package.json is a file,
 1. a. Parse X/package.json, and look for "main" field.
 1. b. let M = X + (json main field)
 1. c. LOAD_AS_FILE(M)
 2. If X/index.js is a file, load X/index.js as JavaScript text.  STOP
 3. If X/index.json is a file, parse X/index.json to a JavaScript object. STOP
 4. If X/index.node is a file, load X/index.node as binary addon.  STOP

 LOAD_NODE_MODULES(X, START)
 1. let DIRS=NODE_MODULES_PATHS(START)
 2. for each DIR in DIRS:
 2. a. LOAD_AS_FILE(DIR/X)
 2. b. LOAD_AS_DIRECTORY(DIR/X)

 NODE_MODULES_PATHS(START)
 1. let PARTS = path split(START)
 2. let I = count of PARTS - 1
 3. let DIRS = []
 4. while I >= 0,
 4. a. if PARTS[I] = "node_modules" CONTINUE
 4. c. DIR = path join(PARTS[0 .. I] + "node_modules")
 4. b. DIRS = DIRS + DIR
 4. c. let I = I - 1
 5. return DIRS

 Things we may want to simulate:
 1. module.cache
 2. module.require
 3. module.id: The identifier for the module. Typically this is the fully resolved filename.
 4. module.filename: The fully resolved filename to the module.
 5. module.loaded: Whether or not the module is done loading, or is in the process of loading.
 6. module.parent: The module that first required this one.
 7. module.children: The module objects required by this one.

 */
