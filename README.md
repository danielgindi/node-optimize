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
* Currently handles only `*.js`, `*.json`.
* Functionality of `require` statements stay the same - loading on demand, loading once, and synthesizing the `module` global object.
* Using `include` option to include files which are not automatically detected (because of dynamic `require`s using variables and other complex loading mechanisms)
* Loading modules which were specified using complex `require` statement (i.e. `require(moduleName + '_' + index)`)

*Note*: Support for `require` of module folders (with parsing of `package.json` etc.) will be added in the future.

## CoffeScript?

This module does not currently support CoffeScript, and I do not currently have plans to support it as I see not use for CoffeScript (or Coffe!).  
If you need to work on CoffeScript, you can use Grunt to copy the project structure to a temp folder, compile all Coffe files, and then run the `node-optimize`.

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
