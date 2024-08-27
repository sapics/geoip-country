const fs = require('fs');
const net = require('net');
const path = require('path');
const exec = require('child_process').exec;

const utils = require('./utils');
const fsWatcher = require('./fsWatcher');
const async = require('async');
const isCountry = require('../package.json').name.indexOf('country') > 0
var watcherName = 'dataWatcher';

var geodatadir = global.geoip_datadir || process.env.npm_config_geoip_datadir || process.env.GEOIP_DATADIR
							|| global.geodatadir || process.env.npm_config_geodatadir || process.env.GEODATADIR; // alias for older version
var unusedFields = global.geoip_unused_fields || process.env.npm_config_geoip_unused_fields || process.env.GEOIP_UNUSED_FIELDS;
var cityRecordSizeChange = 0;
if(!geodatadir && process.argv) {
	for(var i = 0; i < process.argv.length; ++i){
		var arg = process.argv[i];
		if(arg.indexOf('datadir=') >= 0){
			geodatadir = arg.slice(arg.indexOf('=') + 1);
		} else if(arg.indexOf('geodatadir=') >= 0){ // alias for older version
			geodatadir = arg.slice(arg.indexOf('=') + 1);
		} else if(arg.indexOf('unused_fields=') >= 0){
			unusedFields = arg.slice(arg.indexOf('=') + 1);
		}
	}
}
geodatadir = path.resolve(
	__dirname,
	geodatadir || '../data/'
);

if(unusedFields){
	unusedFields = unusedFields.split(',');
	cityRecordSizeChange = utils.fieldsSize(unusedFields);
} else {
	unusedFields = [];
}

const COUNTRY_RECORD_SIZE = 10;
const COUNTRY_RECORD_SIZE6 = 18;
var cache4 = {recordSize: COUNTRY_RECORD_SIZE + 17 - cityRecordSizeChange};
var cache6 = {recordSize: COUNTRY_RECORD_SIZE6 + 17 - cityRecordSizeChange};

var state1Json, region1Json, state2Json, region2Json;
var cityJson, timezoneJson;
var countryJson = require('../node_modules/countries-list/countries.min.json');
var continentJson = require('../node_modules/countries-list/continents.min.json');

function getZeroFill(str, len){
	while(str.length < len){
		str = '0' + str;
	}
	return str;
}
function setCityRecord(buffer, geodata, offset, locBuffer){
	var locId = buffer.readUInt32BE(offset);
	offset += 4
	if(-1 >>> locId){
		var locOffset = locId * 14;
		geodata.country = locBuffer.toString('utf8', locOffset, locOffset += 2);
		var sub1 = locBuffer.readUInt16BE(locOffset)
		locOffset += 2
		if(sub1 > 0) {
			geodata.region1 = region1Json[sub1];
			geodata.state1 = state1Json[sub1];
		}
		var sub2 = locBuffer.readUInt16BE(locOffset)
		locOffset += 2
		if(sub2 > 0) {
			geodata.region2 = region2Json[sub2]
			geodata.state2 = state2Json[sub2]
		}
		var metro = locBuffer.readUInt16BE(locOffset)
		locOffset += 2
		if(metro > 0) geodata.metro = metro;
		var city = locBuffer.readUInt32BE(locOffset)
		locOffset += 4
		if(city > 0) geodata.city = cityJson[city];
		var timezone = locBuffer.readUInt16BE(locOffset)
		if(timezone > 0) geodata.timezone = timezoneJson[timezone];
	}

	if(!unusedFields.includes('latitude')){
		geodata.latitude = buffer.readInt32BE(offset) / 10000;
		offset += 4
	}
	if(!unusedFields.includes('longitude')){
		geodata.longitude = buffer.readInt32BE(offset) / 10000;
		offset += 4
	}
	if(!unusedFields.includes('area')){
		geodata.area = buffer.readUInt16BE(offset);
		offset += 2
	}
	if(!unusedFields.includes('postcode')){
		var postcode2 = buffer.readUInt32BE(offset);
		var postcode1 = buffer.readInt8(offset + 4);
		if (postcode2) {
			var postcode, tmp;
			if(postcode1 === 0){
				postcode = postcode2.toString(36);
			} else if(postcode1 < 0){
				tmp = (-postcode1).toString();
				postcode = postcode2.toString(36);
				postcode = getZeroFill(postcode.slice(0, -tmp[1]), tmp[0]-0) + '-' + getZeroFill(postcode.slice(-tmp[1]), tmp[1]-0);
			} else if(postcode1 < 10){
				postcode = getZeroFill(postcode2.toString(10), postcode1)
			} else if(postcode1 < 72){
				postcode1 = String(postcode1)
				postcode = getZeroFill(postcode2.toString(10), (postcode1[0]-0) + (postcode1[1]-0));
				postcode = postcode.slice(0, postcode1[0]-0) + '-' + postcode.slice(postcode1[0]-0);
			} else {
				postcode = postcode1.toString(36).slice(1) + postcode2.toString(36);
			}
			geodata.postcode = postcode.toUpperCase();
		}
	}
}

function setCountryInfo(geodata){
	if(countryJson[geodata.country]){
		Object.assign(geodata, countryJson[geodata.country]);
		if(geodata.continent && continentJson[geodata.continent]){
			geodata.continent_name = continentJson[geodata.continent];
		}
	}
	return geodata;
}

function lookup4(ip) {
	var fline = 0;
	var cline = cache4.lastLine;
	var line, offset;
	var buffer = cache4.mainBuffer;
	var recordSize = cache4.recordSize;
	var geodata = {};
	for(;;) {
		line = fline + cline >> 1;
		if(buffer.readUInt32BE(offset = line * recordSize) > ip){
			if(cline === line){
				return null;
			}
			cline = line;
			continue;
		}
		if (buffer.readUInt32BE(offset + 4) < ip) {
			if(fline === line){
				return null;
			}
			fline = line
			continue;
		}
		offset += 8;
		if(isCountry){
			geodata.country = buffer.toString('utf8', offset, offset + 2);
		} else {
			setCityRecord(buffer, geodata, offset, cache4.locationBuffer);
		}
		return setCountryInfo(geodata);
	}
}

// XXX We only use the first 8 bytes of an IPv6 address
// This identifies the network, but not the host within
// the network.  Unless at some point of time we have a
// global peace treaty and single subnets span multiple
// countries, this should not be a problem.
function readipv6(start, offset){
	return cache6.mainBuffer.readBigUInt64BE(start + offset * 8);
}

function lookup6(ip) {
	var fline = 0;
	var cline = cache6.lastLine;
	var line, offset;
	var recordSize = cache6.recordSize;
	var geodata = {};

	for(;;) {
		line = fline + cline >> 1;
		if(readipv6(offset = line * recordSize, 0) > ip) {
			if(cline === line) {
				return null;
			}
			cline = line;
			continue;
		}
		
		if(readipv6(offset, 1) < ip) {
			if(fline === line) {
				return null;
			}
			fline = line;
			continue;
		}

		offset += 16;
		if(isCountry){
			geodata.country = cache6.mainBuffer.toString('utf8', offset, offset + 2);
		} else {
			setCityRecord(cache6.mainBuffer, geodata, offset, cache4.locationBuffer);
		}
		return setCountryInfo(geodata);
	}
}

function get4mapped(ip) {
  var ipv6 = ip.toUpperCase();
  var v6prefixes = ['0:0:0:0:0:FFFF:', '::FFFF:'];
  for (var i = 0; i < v6prefixes.length; i++) {
		var v6prefix = v6prefixes[i];
		if (ipv6.startsWith(v6prefix)) {
			return ipv6.substring(v6prefix.length);
		}
  }
  return null;
}

function preload(callback) {
	var dataFiles = {
		city: path.join(geodatadir, 'geoip-city.dat'),
		city6: path.join(geodatadir, 'geoip-city6.dat'),
		cityNames: path.join(geodatadir, 'geoip-city-names.dat'),
		country: path.join(geodatadir, 'geoip-country.dat'),
		country6: path.join(geodatadir, 'geoip-country6.dat')
	};

	var datFile, datFile6;
	var datSize, datSize6;
	var locFile, locSize, locBuffer;
	var tmpBuffer, tmpBuffer6
	// preload the data
	var funcs
	if(isCountry){
		funcs = [
			function(cb){
				fs.open(dataFiles.country, 'r', function(err, fd){
					datFile = fd;
					cache4.recordSize = COUNTRY_RECORD_SIZE;
					cb(err);
				});
			},
			function(cb){
				fs.open(dataFiles.country6, 'r', function(err, fd){
					datFile6 = fd;
					cache6.recordSize = COUNTRY_RECORD_SIZE6;
					cb(err);
				});
			}
		]
	} else {
		funcs = [
			function(cb){
				fs.open(dataFiles.city, 'r', function(err, fd){
					datFile = fd;
					cb(err);
				});
			},
			function(cb){
				fs.open(dataFiles.city6, 'r', function(err, fd){
					datFile6 = fd;
					cb(err);
				});
			},
			function(cb){
				fs.open(dataFiles.cityNames, 'r', function(err, fd){
					locFile = fd;
					cb(err);
				});
			},
			function(cb){
				fs.fstat(locFile, function(err, stats){
					locSize = stats.size;
					locBuffer = Buffer.alloc(locSize)
					cb(err);
				});
			},
			function(cb){
				fs.read(locFile, locBuffer, 0, locSize, 0, function(err){
					fs.close(locFile, function(){}); // close the file
					cb(err);
				});
			}
		]
	}

	funcs.push(
		function(cb){
			fs.fstat(datFile, function(err, stats){
				datSize = stats.size;
				cb(err);
			})
		},
		function(cb){
			fs.read(datFile, tmpBuffer, 0, datSize, 0, function(err){
				tmpBuffer = Buffer.alloc(datSize);
				fs.close(datFile, function(){}); // close the file
				cb(err);
			});
		},
		function(cb){
			fs.fstat(datFile6, function(err, stats){
				datSize6 = stats.size;
				cb(err);
			})
		},
		function(cb){
			tmpBuffer6 = Buffer.alloc(datSize6)
			fs.read(datFile6, tmpBuffer6, 0, datSize6, 0, function(err){
				fs.close(datFile6, function(){});
				cb(err);
			});
		},
		function(cb){
			cache4.mainBuffer = tmpBuffer;
			cache4.lastLine = (datSize / cache4.recordSize) - 1;
		
			cache6.mainBuffer = tmpBuffer6;
			cache6.lastLine = (datSize6 / cache6.recordSize) - 1;
			if(!isCountry){
				var tmpJson = require(path.join(geodatadir, 'geoip-city-sub.json'));
				state1Json = tmpJson.state1;
				state2Json = tmpJson.state2;
				region1Json = tmpJson.region1;
				region2Json = tmpJson.region2;
				cityJson = tmpJson.city;
				timezoneJson = tmpJson.timezone;
				cache4.locationBuffer = locBuffer;
			}
			cb();
		}
	)
	if(callback){
		async.series(funcs, function(err){
			if(err) console.warn(err);
			callback(err);
		});
	} else {
		if(isCountry){
			datFile = fs.openSync(dataFiles.country, 'r');
			cache4.recordSize = COUNTRY_RECORD_SIZE;
			datFile6 = fs.openSync(dataFiles.country6, 'r');
			cache6.recordSize = COUNTRY_RECORD_SIZE6;
		} else {
			datFile = fs.openSync(dataFiles.city, 'r');
			datFile6 = fs.openSync(dataFiles.city6, 'r');
			locFile = fs.openSync(dataFiles.cityNames, 'r');
			locSize = fs.fstatSync(locFile).size;
			cache4.locationBuffer = locBuffer = Buffer.alloc(locSize);
			fs.readSync(locFile, locBuffer, 0, locSize, 0);
			fs.closeSync(locFile);
			var tmpJson = require(path.join(geodatadir, 'geoip-city-sub.json'));
			state1Json = tmpJson.state1;
			state2Json = tmpJson.state2;
			region1Json = tmpJson.region1;
			region2Json = tmpJson.region2;
			cityJson = tmpJson.city;
			timezoneJson = tmpJson.timezone;
		}

		datSize = fs.fstatSync(datFile).size;
		tmpBuffer = Buffer.alloc(datSize);
		fs.readSync(datFile, tmpBuffer, 0, datSize, 0);
		fs.closeSync(datFile);

		datSize6 = fs.fstatSync(datFile6).size;
		tmpBuffer6 = Buffer.alloc(datSize6);
		fs.readSync(datFile6, tmpBuffer6, 0, datSize6, 0);
		fs.closeSync(datFile6);

		cache4.mainBuffer = tmpBuffer;
		cache4.lastLine = (datSize / cache4.recordSize) - 1;

		cache6.mainBuffer = tmpBuffer6;
		cache6.lastLine = (datSize6 / cache6.recordSize) - 1;
	}
}

preload();

module.exports = {
	lookup: function(ip) {
		var ipv = net.isIP(ip)
		if (ipv === 4) {
			return lookup4(utils.aton4(ip));
		}
		if (ipv === 6) {
			var ipv4 = get4mapped(ip);
			if (ipv4) {
				return lookup4(utils.aton4(ipv4));
			} else {
				return lookup6(utils.aton6(ip));
			}
		}
		if (typeof ip === 'number') {
			return lookup4(ip);
		}
		return null;
	},

	/**
	 * @param {string} [license_key]
	 * 		Without license_key, you need to set GEOLITE2_LICENSE_KEY as environmental variable
	 * @param {function} [callback]
	 */
	updateDatabase(license_key, callback){
		var command = 'node ' + path.join(__dirname, '..', 'scripts', 'updatedb.js')
		var options = {encoding: 'utf-8'}
		if(typeof license_key === 'function'){
			callback = license_key
			options.env = Object.assign({}, process.env || {})
		} else {
			options.env = Object.assign({},
					process.env || {},
					{GEOLITE2_LICENSE_KEY: license_key})
		}
		if(!callback){
			callback = function(){}
		}

		exec(command, options, function(error, stdout, stderr){
			if(error){
				return callback(error, stdout, stderr);
			}
			//Reload data
			preload(callback);
		});
	},

	// Start watching for data updates. The watcher waits one minute for file transfer to 
	// completete before triggering the callback.
	startWatchingDataUpdate: function (callback) {
		fsWatcher.makeFsWatchFilter(watcherName, geodatadir, 60*1000, function () {
			preload(callback);
		});
	},

	// Stop watching for data updates.
	stopWatchingDataUpdate: function () {
		fsWatcher.stopWatching(watcherName);
	},

	// clear data
	clear: function(){
		cache4 = {recordSize: cache4.recordSize}
		cache6 = {recordSize: cache6.recordSize}
	},

	// Reload data synchronously
	reloadDataSync: function(){
		preload();
	},

	// Reload data asynchronously
	reloadData: function(callback){
		preload(callback);
	}
};
