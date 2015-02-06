"use strict";

var fs = require('fs'),
    path = require('path'),
    UglifyJS = require('uglify-js');

var optimizer = function (options) {

    this.options = {
        ignoreRequired: (options ? options.ignoreRequired : null) || []
    };

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

var getRequireStatements = function(ast, mainFilePath) {
    var results = [];

    var processRequireNode = function(text, args) {
        if (args.length !== 1) {
            return 'unknown';
        }
        var modulePath = args[0].value;
        if (modulePath == null) {
            return 'unknown';
        }

        if (/[/\\]/.test(modulePath)) {
            var absoluteModulePath = path.resolve(fileDir, modulePath);

            if (!fs.existsSync(absoluteModulePath)) {
                if (!/\.js$/i.test(absoluteModulePath)) {
                    absoluteModulePath = absoluteModulePath + '.js';
                }
                if (!fs.existsSync(absoluteModulePath)) {
                    return 'not-exists';
                }
            }

            var absoluteModulePathFile = fs.lstatSync(absoluteModulePath);
            if (absoluteModulePathFile && absoluteModulePathFile.isDirectory()) {
                return 'directory';
            }

            results.push({
                text: text,
                path: absoluteModulePath
            });

            return true;
        }

        return 'core';
    };

    var fileDir = path.dirname(mainFilePath);
    ast.walk(new UglifyJS.TreeWalker(function(node) {

        if (node instanceof UglifyJS.AST_Call) {

            while (/\brequire\b/.test(node.print_to_string()) && node.expression && node.expression.print_to_string() !== 'require') {
                node = node.expression;
            }

            if (node.expression && node.expression.print_to_string() === 'require') {

                var text = node.print_to_string({ beautify: false });
                var ret = processRequireNode(text, node.args);
                if (ret !== true && ret !== 'core') {
                    console.log('Unhandled require in file: ' + mainFilePath + ', in: ' + text);
                }

                return true;

            }
        }
    }));

    return results;
};

var regexEscapePattern = /([-\/()[\]?{}|*+\\:\.])/g;
var regexEscape = function (string) {
    return string.replace(regexEscapePattern, "\\$1");
};

optimizer.prototype.merge = function(mainFilePath) {

    mainFilePath = path.resolve(mainFilePath) || path.resolve(process.cwd(), mainFilePath);
    var rootDir = fs.lstatSync(mainFilePath).isDirectory() ? path.resolve(mainFilePath) : path.dirname(path.resolve(mainFilePath));
    rootDir += /\\/.test(path.resolve('/path/to')) ? '\\' : '/';

    if (!fs.existsSync(mainFilePath)) {
        throw new Error("Main file not found " + mainFilePath);
    }

    var filteredOutFiles = getMatchingFiles(rootDir, this.options.ignoreRequired);

    var requiredMap = {};

    var requireFileMode = function (filePath) {
        if (filteredOutFiles.filter(function(filter) {
                return path.normalize(filter) === path.normalize(filePath);
            }).length > 0) return 'normalize_path';

        if (filePath.substr(0, rootDir.length).toLowerCase() !== rootDir.toLowerCase()) {
            return false;
        }

        filePath = filePath.substr(rootDir.length);

        if (/^node_modules$|\/node_modules$|^node_modules\/|\\node_modules$|^node_modules\\/.test(filePath)) {
            return false;
        }

        return true;
    };

    var recursiveSourceGrabber = function(filePath) {

        var required = {};

        var sourceCode = required.source = fs.readFileSync(filePath, { encoding: 'utf8' }).toString();
        requiredMap[filePath] = required;

        var ast = UglifyJS.parse(sourceCode);
        var requireStatements = getRequireStatements(ast, filePath);

        requireStatements.forEach(function (requireStatement) {
            requireStatement.path = path.resolve(filePath, requireStatement.path);
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

    recursiveSourceGrabber(mainFilePath);

    var index = 0;

    // Assign module keys and prepare for storing in the 'required' container
    Object.keys(requiredMap).forEach(function (modulePath) {
        if (modulePath === mainFilePath) return;

        var moduleToInline = requiredMap[modulePath];

        moduleToInline.key = 'a' + index++;
        moduleToInline.source = '\
(function(){\
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
    var loadModule = function(module, exports){\n\n' + moduleToInline.source + '\n\n}; \
    \
    return function () {\
        if (!fakeModule.loaded) {\
            loadModule(fakeModule, fakeModule.exports);\
            fakeModule.loaded = true;\
        }\
        return fakeModule.exports;\
    }; \
})()';

    });

    // Replace require calls
    Object.keys(requiredMap).forEach(function (modulePath) {
        var moduleToInline = requiredMap[modulePath];
        moduleToInline.required.forEach(function (requiredStatement) {

            var regex = regexEscape(requiredStatement.text);
            regex = regex.replace(/^require\\\("/, 'require\\(\\s*["\']')
                .replace(/"\\\)$/, '["\']\\s*\\)');

            if (requiredStatement.mode === 'normalize_path') {

                var relativePath = path.relative(rootDir, requiredStatement.path);
                if (!/^[\./\\]/.test(relativePath) && !/:\//.test(relativePath)) {
                    relativePath = './' + relativePath;
                }

                moduleToInline.source = moduleToInline.source.replace(new RegExp(regex, 'g'), 'require(' + JSON.stringify(relativePath) + ')');

            } else if (requiredStatement.mode === true) {

                moduleToInline.source = moduleToInline.source.replace(new RegExp(regex, 'g'), '((__REQUIRED_NODE_MODULES__.' + requiredMap[requiredStatement.path].key + ')())');

            }

        });
    });

    var source = '', isFirstRequired = true;
    source += 'var __REQUIRED_NODE_MODULES__ = {';
    Object.keys(requiredMap).forEach(function (modulePath) {
        if (modulePath === mainFilePath) return;

        var moduleToInline = requiredMap[modulePath];

        if (isFirstRequired) isFirstRequired = false;
        else source += ', ';

        source += moduleToInline.key + ': \n' + moduleToInline.source + '\n';
    });
    source += '};';

    source += requiredMap[mainFilePath].source;

    console.log('Optimized node project starting with ' + mainFilePath);

    return source;
};

module.exports = optimizer;