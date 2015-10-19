node-optimize
=============

[![npm Version](https://badge.fury.io/js/node-optimize.png)](https://npmjs.org/package/node-optimize)

We all need a tool to optimize a node.js project and create a single `js` file from it, 
Taking care of `require`s and leaving out `node_modules`.

Well I needed one too, and there wasn't one, so I build it!

Usage:
```javascript

	var NodeOptimizer = require('node-optimize');
	var optimizer = new NodeOptimizer({ 
		ignore: [
			'config/db.js',
			'private/some-other-file.js',
		]
	});
	
    var mergedJs = optimizer.merge('main.js'); // node-optimize will automatically resolve that path for 'main.js' using path.resolve(...)
	
	require('fs').writeFile(require('path').resolve('main.optimized.js'), mergedJs);
	
```

## What's in the bag

* `options.ignore` -> Tell it which files to ignore in the process of expanding the `require` calls.
* Automatically ignores core modules, or modules from `node_modules`.
* Currently handles `*.js`, `*.json`, and directory modules (with or without package.json/main).
* Functionality of `require` statements stay the same - loading on demand, loading once, and synthesizing the `module` global object.
* Handling of cyclic references same as node.js's' native implementation
* Using `include` option to include files which are not automatically detected (because of dynamic `require`s using variables and other complex loading mechanisms)
* Loading modules which were specified using complex `require` statement (i.e. `require(moduleName + '_' + index)`)

*Note*: Support for `require` of module folders (with parsing of `package.json` etc.) will be added in the future.

## CoffeeScript

If you need support for CoffeScript, simply use Grunt to "compile" your Coffee files, and then run the optimizer on a pure JS project.

## Binary modules

There's no simple way to embed native binary modules (*.node), or modules that depend on other local raw files.
In case you have a module which is known to have binary files, you should exclude it from optimization, and put it in a known path, or on a private NPM etc.

I've tried to also support squashing `node_modules` for cases where one wants to eliminate the need of an `npm install` in a production project,
but I have abandon those trials, as it makes no sense:
In 99% of the cases on of the modules in the `node_modules` tree will have binaries, and `npm install`/`npm update` is a strength anyway as it allows for bugfixes even in a production project.

## Grunt

See [https://github.com/danielgindi/grunt-node-optimize](https://github.com/danielgindi/grunt-node-optimize)


## Contributing

If you have anything to contribute, or functionality that you luck - you are more than welcome to participate in this!  
If anyone wishes to contribute unit tests - that also would be great :-)

## Me
* Hi! I am Daniel Cohen Gindi. Or in short- Daniel.
* danielgindi@gmail.com is my email address.
* That's all you need to know.

## Help

If you want to buy me a beer, you are very welcome to
[![Donate](https://www.paypalobjects.com/en_US/i/btn/btn_donate_LG.gif)](https://www.paypal.com/cgi-bin/webscr?cmd=_s-xclick&hosted_button_id=G6CELS3E997ZE)
 Thanks :-)

## License

All the code here is under MIT license. Which means you could do virtually anything with the code.
I will appreciate it very much if you keep an attribution where appropriate.

    The MIT License (MIT)

    Copyright (c) 2013 Daniel Cohen Gindi (danielgindi@gmail.com)

    Permission is hereby granted, free of charge, to any person obtaining a copy
    of this software and associated documentation files (the "Software"), to deal
    in the Software without restriction, including without limitation the rights
    to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
    copies of the Software, and to permit persons to whom the Software is
    furnished to do so, subject to the following conditions:

    The above copyright notice and this permission notice shall be included in all
    copies or substantial portions of the Software.
