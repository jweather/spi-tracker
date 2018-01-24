var udp = require('dgram');
var osc = require('osc-min');
var util = require('util');

var inport = 8000, outport = 9000;
var spiIn = 7000;
var iPad = {};

var fxNames = ['reverb', 'distortion', 'bitcrusher', 'panslicer', 'flanger', 'wobble'];
var defaultParams = {attack: 0, release: 0.25, echo: 0.2, phase: 0.375, amp: 0.5, octave: 0, fx: 0, fxMix: 0}

var noteNames = [
	['Eb', 'F', 'G', 'Ab', 'Bb', 'C', 'D', 'Eb'],
	['Eb', 'F', 'G', 'Ab', 'Bb', 'C', 'D', 'Eb'],
	['Eb', 'F', 'G', 'Ab', 'Bb', 'C', 'D', 'Eb'],
	['kick', 'snare', 'open hat', 'closed hat', 'clap', 'boing', 'ding', 'splash'],
	['burp', 'chime', 'twang', 'pop', 'flip', 'tick', 'twip', 'ping'],
	['slice1', 'slice2', 'slice3', 'slice4', 'slice5', 'slice6', 'slice7', 'slice8']
];

var maxP = 8, maxX = 8, maxY = 8, maxI = 6;
var xy = [], pattern = [], params = [];
var col = []; for (var y=0; y<maxY; y++) { col.push(0); }
for (var i=0; i<maxI; i++) {
	xy[i] = [];
	for (var p=0; p<maxP; p++) {
		xy[i][p] = []
		for (var x=0; x<maxX; x++) { 
			xy[i][p].push(col.slice(0));
		}
	}

	pattern[i] = []
	for (var x=0; x<maxX; x++) {
		pattern[i].push(0);
	}
	params[i] = {};
	Object.keys(defaultParams).forEach(function(p) {
		params[i][p] = defaultParams[p];
	});
}

sock = udp.createSocket("udp4", function(msg, rinfo) {
	var error;
	var ip = rinfo.address;
	if (!iPad[ip]) {
		console.log('adding new iPad: ' + ip);
		iPad[ip] = {inst: 0, pat: 0, sync: true};
		refresh(ip);
	}
	try {
		var data = osc.fromBuffer(msg);
		if (data.args[0].value == 0 && !data.address.match('^/param/')) {
			// ignoring all release messages for now
			return;
		}
		console.log('OSC RX ' + data.address + ': ' + data.args[0].value);

		var inst = iPad[rinfo.address].inst;
		var pat = iPad[rinfo.address].pat;
		var parts;
		if (parts = data.address.match('^/xy/(.*)/(.*)')) {
			// set XY note
			var y = maxY-parts[1], x = parts[2]-1; // bottom is y=0
			
			var val = 1-xy[inst][pat][x][y];
			setXY(inst, pat, x, y, val);
	
		} else if (parts = data.address.match('^/pattern/(.*)/(.*)')) {
			// set pattern block
			var y = maxP-parts[1], x = parts[2]-1; // bottom is y=0
			setPat(inst, x, y);
			
		} else if (parts = data.address.match('^/patedit/(.*)/1')) {
			// edit a different pattern
			var y = maxP-parts[1];
			console.log('edit pattern ' + y);
			selectPattern(ip, y, {interactive: true});
			
		} else if (parts = data.address.match('^/param/(.*)')) {
			// set parameter
			var p = parts[1];
			setParam(inst, p, data.args[0].value);
			
		} else if (data.address == '/fx') {
			// fx param
			var fx = (params[inst].fx + 1)%fxNames.length;
			setParam(inst, 'fx', fx);
			Object.keys(iPad).filter(function(ip) { return iPad[ip].inst == inst; }).forEach(function(ip) {
				sendString(ip, '/fxtext', fxNames[fx]);
			});

		} else if (parts = data.address.match('^/inst/1/(.*)')) {
			var inst = parts[1]-1;
			selectInst(ip, inst);
			
		} else if (data.address == '/patsync') {
			iPad[ip].sync = !iPad[ip].sync;
			sendFloat(ip, '/patsync', iPad[ip].sync ? 1 : 0);
			if (iPad[ip].sync) {
				selectPattern(ip, pattern[inst][lastPtime], {interactive: false});
			}
			
		} else if (parts = data.address.match('^/labels/(.*)/1')) {
			var y = parts[1]-1;
			runSPI('tempPlay ' + inst + ', ' + y);
			
		} else {
			console.log('Unknown OSC RX: ', data);
		}
	} catch (err) {
		return console.log(err.stack.split("\n"));
	}
});

function setXY(inst, pat, x, y, val) {
	xy[inst][pat][x][y] = val;
	console.log('push ' + x + ',' + y + ' = inst ' + inst + ', pat ' + pat + ' = ' + val);
	runSPI('setXY ' + inst + ', ' + pat + ', ' + util.inspect(xy[inst][pat]));
	Object.keys(iPad).filter(function(ip) { return iPad[ip].inst == inst && iPad[ip].pat == pat; }).forEach(function(ip) {
		sendMatrix(ip, '/xy', xy[inst][pat]);
	});
}

function setPat(inst, x, val) {
	pattern[inst][x] = val;
	console.log('pattern ' + x + ' for inst ' + inst + ' = ' + val);
	runSPI('setPattern ' + inst + ', ' + util.inspect(pattern[inst]));
	Object.keys(iPad).filter(function(ip) { return iPad[ip].inst == inst; }).forEach(function(ip) {
		sendMatrix(ip, '/pattern', patternMatrix(pattern[inst]));
	});
}

function setParam(inst, param, val) {
	params[inst][param] = val;
	runSPI('setParam ' + inst + ', :' + param + ', ' + val);
	Object.keys(iPad).filter(function(ip) { return iPad[ip].inst == inst }).forEach(function(ip) {
		sendFloat(ip, '/param/' + param, val);
	});
}

function selectPattern(ip, pat, opts) {
	var inst = iPad[ip].inst;
	if (opts.interactive && iPad[ip].sync) {
		iPad[ip].sync = false;
		sendFloat(ip, '/patsync', 0);
	}
	iPad[ip].pat = pat;
	console.log('selectPattern: inst=' + inst + ', pat = ' + pat);
	sendMatrix(ip, '/xy', xy[inst][pat]);
	sendArray(ip, '/patedit', bitArray(maxP, pat).reverse()); // flip Y-axis for TouchOSC
}

function selectInst(ip, inst) {
	iPad[ip].inst = inst;
	sendArray(ip, '/inst', bitArray(maxI, inst));
	if (iPad[ip].sync) {
		iPad[ip].pat = pattern[inst][lastPtime];
	}
	if (iPad[ip].pat == undefined) iPad[ip].pat = 0;
	var pat = iPad[ip].pat;
	console.log('pat=' + pat + ' in selectInst');
	sendMatrix(ip, '/pattern', patternMatrix(pattern[inst]));
	selectPattern(ip, pat, {interactive: false});

	Object.keys(defaultParams).forEach(function(p) {
		sendFloat(ip, '/param/' + p, params[inst][p]);
	});
	sendString(ip, '/fxtext', fxNames[params[inst].fx]);
	for (var y=0; y<maxY; y++) {
		sendString(ip, '/note/' + (y+1), noteNames[inst][y]);
	}
}

function refresh(ip) {
	sendFloat(ip, '/patsync', iPad[ip].sync ? 1 : 0);
	selectInst(ip, iPad[ip].inst);
}

function sendString(ip, add, val) {
	var msg = { address: add, args: [ { type: 'string', value: val } ], oscType: 'message' };
	var buf = osc.toBuffer(msg);
	sock.send(buf, 0, buf.length, outport, ip);
}	

function sendFloat(ip, add, val) {
	var msg = { address: add, args: [ { type: 'float', value: val } ], oscType: 'message' };
	var buf = osc.toBuffer(msg);
	sock.send(buf, 0, buf.length, outport, ip);
}

// inverts Y axis for TouchOSC
function sendMatrix(ip, add, matrix) {
	var args = [];
	for (var x=0; x<maxX; x++) {
		for (var y=maxY-1; y>=0; y--) {
			args.push({type: 'float', value: matrix[x][y]});
		}
	}
	var msg = { address: add, args: args, oscType: 'message' };
	var buf = osc.toBuffer(msg);
	sock.send(buf, 0, buf.length, outport, ip);
}

function sendArray(ip, add, arr) {
	var args = [];
	for (var i=0; i<arr.length; i++) {
		args.push({type: 'float', value: arr[i]});
	}
	var msg = { address: add, args: args, oscType: 'message' };
	var buf = osc.toBuffer(msg);
	sock.send(buf, 0, buf.length, outport, ip);
}

function runSPI(code) {
	console.log('SPI TX: ' + code);
	var msg = { address: '/run-code', args: [ {type: 'integer', value: 0}, { type: 'string', value: code } ], oscType: 'message' };
	var buf = osc.toBuffer(msg);
	sock.send(buf, 0, buf.length, 4557, 'localhost');
}

function spiRefresh() {
	var code = [];
	for (var inst=0; inst<maxI; inst++) {
		for (var pat=0; pat<maxP; pat++) {
			code.push('setXY ' + inst + ', ' + pat + ', ' + util.inspect(xy[inst][pat]));
		}
		code.push('setPattern ' + inst + ', ' + util.inspect(pattern[inst]));
		Object.keys(defaultParams).forEach(function(param) {
			code.push('setParam ' + inst + ', :' + param + ', ' + params[inst][param]);
		});
	}
	code.push('oscBoot');
	runSPI(code.join('\n'));
}

// read time and pattern # from Sonic Pi
var lastPtime = -1;
var spiTimeout = null;
spisock = udp.createSocket("udp4", function(msg, rinfo) {
	var error;
	var parts = msg.toString().match('time=(.*), pat=(.*)');
	if (parts) {
		if (spiTimeout == null) {
			console.log('Sonic Pi online!');
			spiRefresh();
		}
	
		var time = parseInt(parts[1], 10);
		var ptime = parseInt(parts[2], 10);
		var timeArray = bitArray(maxX, time), zeroArray = bitArray(maxX, -1);
		var patArray = bitArray(maxP, ptime);

		if (ptime != lastPtime) {
			console.log('new ptime = ' + ptime);
			// update pattern position, including switching synced iPad to playing pattern
			Object.keys(iPad).forEach(function(ip) {
				sendArray(ip, '/ptempo', patArray);
				if (iPad[ip].sync) {
					var inst = iPad[ip].inst;
					selectPattern(ip, pattern[inst][ptime], {interactive: false});
				}
			});
		}
		lastPtime = ptime;

		Object.keys(iPad).forEach(function(ip) {
			if (iPad[ip].pat == pattern[iPad[ip].inst][ptime])
				sendArray(ip, '/tempo', timeArray);
			else
				sendArray(ip, '/tempo', zeroArray);
		});
		if (spiTimeout != null) clearTimeout(spiTimeout);
		spiTimeout = setTimeout(function() {
			console.log('Sonic Pi offline');
			spiTimeout = null;
		}, 1000);
	}
});

spisock.bind(7000, function(err) {
	if (err) console.log(err);
	else console.log('Ready for Sonic Pi on 7000');
});
sock.bind(8000, function(err) {
	if (err) console.log(err);
	else console.log('Ready for OSC on 8000');
});

function bitArray(len, sel) {
	var res = [];
	for (var i=0; i<len; i++) {
		if (i==sel)
			res.push(1);
		else
			res.push(0);
	}
	return res;
}

function patternMatrix(p) {
	// patterns are arrays, build a matrix out of it
	var res = [];
	for (var x=0; x<maxX; x++) {
		res.push(bitArray(maxP, p[x]));
	}
	return res;
}
