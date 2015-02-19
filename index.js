"use strict";

var fs = require('fs'),
    path = require('path'),
    UglifyJS = require('uglify-js');

var optimizer = function (options) {

    this.options = {
        ignore: (options ? options.ignore || options.ignoreRequired : null) || [],
        include: (options ? options.include : null) || []
    };

};

var resolveRelativePath = function (from, to) {

    var relPath = path.relative(from, to);
    if (!/^[\./\\]/.test(relPath) && !/:\//.test(relPath)) {
        relPath = './' + relPath;
    }

    // Normalize path if possible
    if (relPath.indexOf(':') === -1) {
        relPath = relPath.replace(/\\/g, '/');
    }

    return relPath;

};

var getMatchingFiles = function(rootDir, filters) {
    var results = [];

    for (var i = 0, len = filters.length; i < len; i++) {
        var destination = path.resolve(rootDir, filters[i]),
            file = null;

        try {
            file = fs.lstatSync(destination);
        } catch (e) {
        }

        if (file && file.isDirectory()) {
            fs.readdirSync(destination).reduce((function(prev, curr) {
                prev.push(path.join(destination, curr));
                return prev;
            }), results);
        } else {
            if (path.extname(destination) === '') {
                var fileName = path.basename(destination);
                fs.readdirSync(path.dirname(destination)).filter(function(fileNameLoc) {
                    return fileNameLoc.indexOf(fileName) !== -1;
                }).reduce((function(prev, curr) {
                    prev.push(path.join(destination, curr));
                    return prev;
                }), results);
            } else {
                results.push(destination);
            }
        }
    }

    return results;

};

var tryJsonParse = function (data) {
  try {
      return JSON.parse(data);
  } catch (e) {
      return null;
  }
};

var getRequireStatements = function(sourceCode, mainFilePath) {

    // Replace newlines in the same way that UglifyJS does
    // So we'll have correct `pos` properties

    sourceCode = sourceCode.replace(/\r\n?|[\n\u2028\u2029]/g, "\n").replace(/\uFEFF/g, '');
    var ast = UglifyJS.parse(sourceCode);

    var results = [];

    var processRequireNode = function(originalText, text, args) {
        if (args.length !== 1) {
            return 'unknown';
        }

        var modulePath = args[0].value;

        /** @type String|Boolean */
        var absoluteModulePath = false;

        if (modulePath) {
            if (/[/\\]/.test(modulePath)) {
                absoluteModulePath = path.resolve(fileDir, modulePath);

                if (!fs.existsSync(absoluteModulePath)) {
                    if (fs.existsSync(absoluteModulePath + '.js')) {
                        absoluteModulePath = absoluteModulePath + '.js';
                    } else if (fs.existsSync(absoluteModulePath + '.json')) {
                        absoluteModulePath = absoluteModulePath + '.json';
                    } else {
                        // TODO: Try as package
                        // 1. If X/package.json is a file, Parse X/package.json, and look for "main" field. Try X + (json main field)
                        // 2. If X/index.js is a file, load X/index.js as JavaScript text.
                        // 3. If X/index.json is a file, parse X/index.json to a JavaScript object.
                        // Write the package.json/main field in the output for later lookup
                    }

                    if (!fs.existsSync(absoluteModulePath)) {
                        return 'not-exists';
                    }
                }

                var absoluteModulePathFile = fs.lstatSync(absoluteModulePath);
                if (absoluteModulePathFile && absoluteModulePathFile.isDirectory()) {
                    return 'directory';
                }
            }
            else {
                return 'core';
            }
        }

        results.push({
            statement: originalText,
            statementArguments: originalText.match(/^require\s*\(([\s\S]*)\)/)[1],
            text: tryJsonParse(text),
            path: absoluteModulePath
        });

        return modulePath ? true : 'complex';
    };

    var fileDir = path.dirname(mainFilePath);

    ast.walk(new UglifyJS.TreeWalker(function(node) {

        if (node instanceof UglifyJS.AST_Call) {

            while (/\brequire\b/.test(node.print_to_string()) && node.expression && node.expression.print_to_string() !== 'require') {
                node = node.expression;
            }

            if (node.expression && node.expression.print_to_string() === 'require') {

                var originalText = sourceCode.substring(node.start.pos, node.end.pos + 1);
                var text = node.print_to_string({ beautify: false });
                var ret = processRequireNode(originalText, text, node.args);
                if (ret !== true && ret !== 'core') {
                    console.log('Ignoring complex require statement in:\n' +
                    '  file      : ' + mainFilePath + '\n' +
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

optimizer.prototype.merge = function(mainFilePath) {

    mainFilePath = path.resolve(mainFilePath) || path.resolve(process.cwd(), mainFilePath);
    var rootDir = fs.lstatSync(mainFilePath).isDirectory() ? path.resolve(mainFilePath) : path.dirname(path.resolve(mainFilePath));
    rootDir += /\\/.test(path.resolve('/path/to')) ? '\\' : '/';

    if (!fs.existsSync(mainFilePath)) {
        throw new Error("Main file not found " + mainFilePath);
    }

    var filteredOutFiles = getMatchingFiles(rootDir, this.options.ignore);
    var includedFiles = getMatchingFiles(rootDir, this.options.include);

    var requiredMap = {};

    var requireFileMode = function (filePath) {

        // This is a complex `required` statement which is not a simple script, leave that to runtime
        if (filePath === false) return 'complex';

        // These will surely be included
        if (includedFiles.filter(function(filter) {
                return path.normalize(filter) === path.normalize(filePath);
            }).length > 0) return true;

        // These will be excluded, but we know that we still need to normalize paths of require to those
        if (filteredOutFiles.filter(function(filter) {
                return path.normalize(filter) === path.normalize(filePath);
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

        var required = {};

        var sourceCode = required.source = fs.readFileSync(filePath, { encoding: 'utf8' }).toString();
        requiredMap[filePath] = required;

        var requireStatements = getRequireStatements(sourceCode, filePath);

        requireStatements.forEach(function (requireStatement) {
            if (requireStatement.path) {
                requireStatement.path = path.resolve(filePath, requireStatement.path);
            }
        });

        requireStatements.forEach(function (requireStatement) {
            requireStatement.mode = requireFileMode(requireStatement.path);
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

    // Recurse through the mail file
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
    source += '\
(function(){ \
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
            if (!fakeModule.loaded) { \
                moduleLoadFunction(fakeModule, fakeModule.exports); \
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
    var path = require("path");\
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
        if (/[/\\\\]/.test(modulePath)) {\
            /* Transform path to distribution path */\
            var relPath;\
            if (originalModulePath) {\
                relPath = path.resolve(path.dirname(originalModulePath), modulePath);\
                relPath = resolveRelativePath(path.dirname(__MAIN_ORIGINAL_PATH__), relPath);\
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
