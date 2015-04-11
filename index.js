var WeakMap = require("weakmap");
var _ = require("lodash");
var assert = require("assert");

var callbackMap = new WeakMap();
var allCallbacks = [];

// registerCallback returns an unregister function
// it also adds tracking info to the weakmap that should include
// file and line number of the function that was passed this callback
// 
// the idea being we know what functions from where were passed our callback
// and if they called it or not (and how many times)
// 
// also we know globally how many times it was called (so we can quickly see if it wasn't called at all)
function registerCallback(cb, opts) {
	var v = callbackMap.get(cb);
	if (!v) {
		v = {
			name: cb.name,
			argCount: cb.length,
			handlers: [],
			called: 0,
		};
		callbackMap.set(cb, v);
		allCallbacks.push(v);
	}
	var handleObj = {
		meta: opts,
		called: 0,
	};

	v.handlers.push(handleObj);

	return _.partial(callbackCalled, v, handleObj);
}

// increment the .called properties so we can track things
function callbackCalled(cbObj, handleObj) {
	cbObj.called++;
	handleObj.called++;
}

// we have to do some sort of eval, since we want the signature to retain the name and arg count
// dirty, but then again, this is a debugging tool and we trade performance for information :)
var buildWrapperFnBuilder = _.memoize(function _buildWrapperFnBuilder(name, argCount) {
	var args = "";
	for (var i=0;i<argCount;i++) {
		if (i>0) {
			args += ",a" + i;
		} else {
			args = "a" + i;
		}
	}
	var fnStr = "(" + wrapperTemplate.toString() + ")";
	fnStr = fnStr.replace("/*NAME*/", name).replace("/*ARGS*/", args);
	return eval(fnStr);
});

// toString me!
function wrapperTemplate(markCalledFn, cbFn) {
	return function /*NAME*/ (/*ARGS*/){
		markCalledFn();
		return cbFn.apply(this, arguments);
	}
}

function wrapCb(cb, opts) {
	// if it wasn't a function for whatever reason, jump out now.
	if (!_.isFunction(cb)) return cb;

	// make sure we were invoked correctly, also so we can guarantee some things down the line
	assert(opts, "cannot wrap callback without tracking data");
	assert(opts.file, ".file property is required");
	assert(opts.line, ".line property is required");

	var wrapper = buildWrapperFnBuilder(cb.name, cb.length);
	var markCalledFn = registerCallback(cb, opts);

	var newCb = wrapper(markCalledFn, cb);

	// make .toString and .prototype work
	// you probably shouldn't be doing this on a callback, but trying to be somewhat complete here
	// since if one person somewhere uses it, then this wont work as a debugging tool for you
	newCb.toString = _.bind(cb, cb.toString);
	newCb.prototype = cb.prototype;

	return newCb;
}

exports.wrap = wrapCb;
exports.pendingCallbacks = _.ary(_.partial(_.reject, allCallbacks, "called"),0);
exports.completeCallbacks = _.ary(_.partial(_.filter, allCallbacks, "called"),0);
exports.allCallbacks = _.ary(_.partial(_.clone, allCallbacks),0);

exports.global = function(){
	if (!global.__cb_inspector_wrap) {
		global.__cb_inspector_wrap = wrapCb;
	} else {
		console.warn("ERROR: cb-inspector already registered in this process.");
	}
	return exports;
}

exports.reportOnExit = function(){
	process.on("exit", function(){
		exports.pendingCallbacks().forEach(function(data){
			console.log("cb never called -- %s args:%d -- was passed to %d handler(s) (none called back)", data.name, data.argCount, data.handlers.length);
			data.handlers.forEach(function(handler){
				console.log("    Passed to function %s at %s:%d", handler.meta.name, handler.meta.file, handler.meta.line)
			});
		});
	});
	return exports;
}

