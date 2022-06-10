/*
* @Author: zhangyu
* @Date:   2021-12-25 17:33:40
* @Last Modified by:   zhangyu
* @Last Modified time: 2021-12-25 20:51:10
* @Email: zhangyu6936@fiberhome.com
*/
const events = require("events");
const util = require("util");

function Events () {
	events.EventEmitter.call(this);
	this.isInterrupt = false;
}

util.inherits(Events, events.EventEmitter);

const event = new Events();

event.on("upload", function (arr, callback) {
	if(arr.length > 0) {
		var func = arr.shift();
		func(function (err, result) {
			if(err) {
				callback(err);
				return;
			}
			event.emit("upload", arr, callback);
		});
	} else {
		callback(null);
	}
});

module.exports = event;