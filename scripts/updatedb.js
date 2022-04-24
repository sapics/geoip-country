// fetches and converts maxmind lite databases

'use strict';

var user_agent = 'Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/39.0.2171.36 Safari/537.36';
var download_server = 'https://download.maxmind.com/app/geoip_download';
var license_key = process.env.npm_config_license_key || process.env.GEOLITE2_LICENSE_KEY || null;

var fs = require('fs');
var https = require('https');
var path = require('path');
var url = require('url');

fs.existsSync = fs.existsSync || path.existsSync;

var async = require('async');
var colors = require('colors');
var iconv = require('iconv-lite');
var lazy = require('lazy');
var rimraf = require('rimraf').sync;
var yauzl = require('yauzl');
var utils = require('../lib/utils');
var Address6 = require('ip-address').Address6;
var Address4 = require('ip-address').Address4;

var dataPath = path.join(__dirname, '..', 'data');
var tmpPath = path.join(__dirname, '..', 'tmp');
var countryLookup = {};
var cityLookup = {};
var databases = [
	{
		type: 'country',
		edition: 'GeoLite2-Country-CSV',
		suffix: 'zip',
		src: [
			'GeoLite2-Country-Locations-en.csv',
			'GeoLite2-Country-Blocks-IPv4.csv',
			'GeoLite2-Country-Blocks-IPv6.csv'
		],
		dest: [
			'',
			'geoip-country.dat',
			'geoip-country6.dat'
		]
	},
	{
		type: 'city',
		edition: 'GeoLite2-City-CSV',
		suffix: 'zip',
		src: [
			'GeoLite2-City-Locations-en.csv',
			'GeoLite2-City-Blocks-IPv4.csv',
			'GeoLite2-City-Blocks-IPv6.csv'
		],
		dest: [
			'geoip-city-names.dat',
			'geoip-city.dat',
			'geoip-city6.dat'
		]
	}
];

function mkdir(name) {
	var dir = path.dirname(name);
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir);
	}
}

// Ref: http://stackoverflow.com/questions/8493195/how-can-i-parse-a-csv-string-with-javascript
// Return array of string values, or NULL if CSV string not well formed.
// Return array of string values, or NULL if CSV string not well formed.

function try_fixing_line(line) {
	var pos1 = 0;
	var pos2 = -1;
	// escape quotes
	line = line.replace(/""/,'\\"').replace(/'/g,"\\'");

	while(pos1 < line.length && pos2 < line.length) {
		pos1 = pos2;
		pos2 = line.indexOf(',', pos1 + 1);
		if(pos2 < 0) pos2 = line.length;
		if(line.indexOf("'", (pos1 || 0)) > -1 && line.indexOf("'", pos1) < pos2 && line[pos1 + 1] != '"' && line[pos2 - 1] != '"') {
			line = line.substr(0, pos1 + 1) + '"' + line.substr(pos1 + 1, pos2 - pos1 - 1) + '"' + line.substr(pos2, line.length - pos2);
			pos2 = line.indexOf(',', pos2 + 1);
			if(pos2 < 0) pos2 = line.length;
		}
	}
	return line;
}

function CSVtoArray(text) {
	var re_valid = /^\s*(?:'[^'\\]*(?:\\[\S\s][^'\\]*)*'|"[^"\\]*(?:\\[\S\s][^"\\]*)*"|[^,'"\s\\]*(?:\s+[^,'"\s\\]+)*)\s*(?:,\s*(?:'[^'\\]*(?:\\[\S\s][^'\\]*)*'|"[^"\\]*(?:\\[\S\s][^"\\]*)*"|[^,'"\s\\]*(?:\s+[^,'"\s\\]+)*)\s*)*$/;
	var re_value = /(?!\s*$)\s*(?:'([^'\\]*(?:\\[\S\s][^'\\]*)*)'|"([^"\\]*(?:\\[\S\s][^"\\]*)*)"|([^,'"\s\\]*(?:\s+[^,'"\s\\]+)*))\s*(?:,|$)/g;
	// Return NULL if input string is not well formed CSV string.
	if (!re_valid.test(text)){
		text  = try_fixing_line(text);
		if(!re_valid.test(text))
			return null;
	}
	var a = []; // Initialize array to receive values.
	text.replace(re_value, // "Walk" the string using replace with callback.
		function(m0, m1, m2, m3) {
			// Remove backslash from \' in single quoted values.
			if      (m1 !== undefined) a.push(m1.replace(/\\'/g, "'"));
			// Remove backslash from \" in double quoted values.
			else if (m2 !== undefined) a.push(m2.replace(/\\"/g, '"').replace(/\\'/g, "'"));
			else if (m3 !== undefined) a.push(m3);
			return ''; // Return empty string.
		});
	// Handle special case of empty last value.
	if (/,\s*$/.test(text)) a.push('');
	return a;
};


function fetch(database, cb) {

	var downloadUrl = download_server + '?edition_id=' + database.edition + '&suffix=' + database.suffix + "&license_key=" + encodeURIComponent(license_key);
	var fileName = database.edition + '.' + database.suffix;

	var tmpFile = path.join(tmpPath, fileName);

	if (fs.existsSync(tmpFile)) {
		return cb(null, tmpFile, fileName, database);
	}

	console.log('Fetching edition ' + database.edition + ' from ' + download_server);

	function getOptions() {
		var options = url.parse(downloadUrl);
		options.headers = {
			'User-Agent': user_agent
		};

		if (process.env.http_proxy || process.env.https_proxy) {
			try {
				var HttpsProxyAgent = require('https-proxy-agent');
				options.agent = new HttpsProxyAgent(process.env.http_proxy || process.env.https_proxy);
			}
			catch (e) {
				console.error("Install https-proxy-agent to use an HTTP/HTTPS proxy");
				process.exit(-1)
			}
		}

		return options;
	}

	function onResponse(response) {
		var status = response.statusCode;

		if (status !== 200) {
			if (status === 401) {
				console.log('ERROR'.red + ': Download Not Allowed — Is Your License Key Valid? [HTTP %d]', status);
			} else {
				console.log('ERROR'.red + ': HTTP Request Failed [%d]', status);
			}

			client.abort();
			process.exit();
		}

		var tmpFileStream = fs.createWriteStream(tmpFile);
		var tmpFilePipe = response.pipe(tmpFileStream);

		tmpFilePipe.on('close', function() {
			console.log(' DONE'.green);
			cb(null, tmpFile, fileName, database);
		});
	}

	mkdir(tmpFile);

	var client = https.get(getOptions(), onResponse);

	process.stdout.write('Retrieving ' + fileName + ' ...');
}

function extract(tmpFile, tmpFileName, database, cb) {
	if (path.extname(tmpFileName) !== '.zip') {
		cb(null, database);
	} else {
		process.stdout.write('Extracting ' + tmpFileName + ' ...');
		yauzl.open(tmpFile, {autoClose: true, lazyEntries: true}, function(err, zipfile) {
			if (err) {
				throw err;
			}
			zipfile.readEntry();
			zipfile.on("entry", function(entry) {
				if (/\/$/.test(entry.fileName)) {
					// Directory file names end with '/'.
					// Note that entries for directories themselves are optional.
					// An entry's fileName implicitly requires its parent directories to exist.
					zipfile.readEntry();
				} else {
					// file entry
					zipfile.openReadStream(entry, function(err, readStream) {
						if (err) {
							throw err;
						}
						readStream.on("end", function() {
							zipfile.readEntry();
						});
						var filePath = entry.fileName.split("/");
						// filePath will always have length >= 1, as split() always returns an array of at least one string
						var fileName = filePath[filePath.length - 1];
						readStream.pipe(fs.createWriteStream(path.join(tmpPath, fileName)));
					});
				}
			});
			zipfile.once("end", function() {
				cb(null, database);
			});
		});
	}
}
function processLookupCountry(src, cb){
	var lines=0;
	function processLine(line) {
		var fields = CSVtoArray(line);
		if (!fields || fields.length < 6) {
			console.log("weird line: %s::", line);
			return;
		}
		countryLookup[fields[0]] = fields[4];
	}
	var tmpDataFile = path.join(tmpPath, src);

	process.stdout.write('Processing Lookup Data (may take a moment) ...');
	var tstart = Date.now();

	lazy(fs.createReadStream(tmpDataFile))
		.lines
		.map(function(byteArray) {
			return iconv.decode(byteArray, 'latin1');
		})
		.skip(1)
		.map(processLine)
		.on('pipe', function() {
			console.log(' DONE'.green);
			cb();
		});
}

function processCountryData(src, dest, cb) {
	var lines = 0, preCC, pos = 0, preEip = 0;
	function processLine(line) {
		var fields = CSVtoArray(line);

		if (!fields || fields.length < 6) {
			console.log("weird line: %s::", line);
			return;
		}
		lines++;

		var sip;
		var eip;
		var rngip;
		var cc = countryLookup[fields[1]];
		var b;
		var bsz;
		var i;
		if(cc){
			if (fields[0].match(/:/)) {
				// IPv6
				bsz = 34;
				rngip = new Address6(fields[0]);
				sip = utils.aton6(rngip.startAddress().correctForm());
				eip = utils.aton6(rngip.endAddress().correctForm());

				if (cc === preCC) {
					var nextSip = preEip;
					for(i = nextSip.length; i--; ) {
						++nextSip[i];
						if(nextSip === 4294967296) {
							nextSip[i] = 0;
						} else {
							break;
						}
					}
					for (i = 0; i < nextSip.length; ++i) {
						if (sip[i] !== nextSip[i]) {
							preCC = null;
							break;
						}
					}
				}

				if (cc !== preCC) {
					b = Buffer.alloc(bsz);
					b.fill(0);
					for (i = 0; i < sip.length; i++) {
						b.writeUInt32BE(sip[i], i * 4);
					}

					for (i = 0; i < eip.length; i++) {
						b.writeUInt32BE(eip[i], 16 + (i * 4));
					}
				} else {
					b = Buffer.alloc(16);
					b.fill(0);
					for (i = 0; i < eip.length; i++) {
						b.writeUInt32BE(eip[i], i * 4);
					}
				}

			} else {
				// IPv4
				bsz = 10;

				rngip = new Address4(fields[0]);
				sip = parseInt(rngip.startAddress().bigInteger(),10);
				eip = parseInt(rngip.endAddress().bigInteger(),10);

				if (preEip + 1 !== sip) {
					preCC = null;
				}
				if (cc !== preCC) {
					b = Buffer.alloc(bsz);
					b.fill(0);
					b.writeUInt32BE(sip, 0);
					b.writeUInt32BE(eip, 4);
				}	else {
					b = Buffer.alloc(4);
					b.fill(0);
					b.writeUInt32BE(eip, 0);
				}
			}

			preEip = eip;
			if (cc !== preCC) {
				b.write(cc, bsz - 2);
				fs.writeSync(datFile, b, 0, bsz, pos);
				pos += bsz;
				preCC = cc;
			} else {
				fs.writeSync(datFile, b, 0, bsz < 16 ? 4: 16, pos - bsz + (bsz < 16 ? 4: 16));
			}
			if(Date.now() - tstart > 5000) {
				tstart = Date.now();
				process.stdout.write('\nStill working (' + lines + ') ...');
			}
		}
	}

	var dataFile = path.join(dataPath, dest);
	var tmpDataFile = path.join(tmpPath, src);

	rimraf(dataFile);
	mkdir(dataFile);

	process.stdout.write('Processing Data (may take a moment) ...');
	var tstart = Date.now();
	var datFile = fs.openSync(dataFile, "w");

	lazy(fs.createReadStream(tmpDataFile))
		.lines
		.map(function(byteArray) {
			return iconv.decode(byteArray, 'latin1');
		})
		.skip(1)
		.map(processLine)
		.on('pipe', function() {
			console.log(' DONE'.green);
			cb();
		});
}

function processCityData(src, dest, cb) {
	var lines = 0;
	function processLine(line) {
		if (line.match(/^Copyright/) || !line.match(/\d/)) {
			return;
		}

		var fields = CSVtoArray(line);
		if (!fields) {
			console.log("weird line: %s::", line);
			return;
		}
		var sip;
		var eip;
		var rngip;
		var locId;
		var b;
		var bsz;

		var i;

		lines++;

		if (fields[0].match(/:/)) {
			// IPv6
			var offset = 0;
			bsz = 48;
			rngip = new Address6(fields[0]);
			sip = utils.aton6(rngip.startAddress().correctForm());
			eip = utils.aton6(rngip.endAddress().correctForm());
			locId = parseInt(fields[1], 10);
			locId = cityLookup[locId];

			b = Buffer.alloc(bsz);
			b.fill(0);

			for (i = 0; i < sip.length; i++) {
				b.writeUInt32BE(sip[i], offset);
				offset += 4;
			}

			for (i = 0; i < eip.length; i++) {
				b.writeUInt32BE(eip[i], offset);
				offset += 4;
			}
			b.writeUInt32BE(locId>>>0, 32);

			var lat = Math.round(parseFloat(fields[7]) * 10000);
			var lon = Math.round(parseFloat(fields[8]) * 10000);
			var area = parseInt(fields[9], 10);
			b.writeInt32BE(lat,36);
			b.writeInt32BE(lon,40);
			b.writeInt32BE(area,44);
		} else {
			// IPv4
			bsz = 24;

			rngip = new Address4(fields[0]);
			sip = parseInt(rngip.startAddress().bigInteger(),10);
			eip = parseInt(rngip.endAddress().bigInteger(),10);
			locId = parseInt(fields[1], 10);
			locId = cityLookup[locId];
			b = Buffer.alloc(bsz);
			b.fill(0);
			b.writeUInt32BE(sip>>>0, 0);
			b.writeUInt32BE(eip>>>0, 4);
			b.writeUInt32BE(locId>>>0, 8);

			var lat = Math.round(parseFloat(fields[7]) * 10000);
			var lon = Math.round(parseFloat(fields[8]) * 10000);
			var area = parseInt(fields[9], 10);
			b.writeInt32BE(lat,12);
			b.writeInt32BE(lon,16);
			b.writeInt32BE(area,20);
		}

		fs.writeSync(datFile, b, 0, b.length, null);
		if(Date.now() - tstart > 5000) {
			tstart = Date.now();
			process.stdout.write('\nStill working (' + lines + ') ...');
		}
	}

	var dataFile = path.join(dataPath, dest);
	var tmpDataFile = path.join(tmpPath, src);

	rimraf(dataFile);

	process.stdout.write('Processing Data (may take a moment) ...');
	var tstart = Date.now();
	var datFile = fs.openSync(dataFile, "w");

	lazy(fs.createReadStream(tmpDataFile))
		.lines
		.map(function(byteArray) {
			return iconv.decode(byteArray, 'latin1');
		})
		.skip(1)
		.map(processLine)
		.on('pipe', cb);
}

function processCityDataNames(src, dest, cb) {
	var locId = null;
	var linesCount = 0;
	function processLine(line, i, a) {
		if (line.match(/^Copyright/) || !line.match(/\d/)) {
			return;
		}

		var b;
		var sz = 88;
		var fields = CSVtoArray(line);
		if (!fields) {
			//lot's of cities contain ` or ' in the name and can't be parsed correctly with current method
			console.log("weird line: %s::", line);
			return;
		}

		locId = parseInt(fields[0]);

		cityLookup[locId] = linesCount;
		var cc = fields[4];
		var rg = fields[6];
		var city = fields[10];
		var metro = parseInt(fields[11]);
		//other possible fields to include
		var tz = fields[12];
		var eu = fields[13];

		b = Buffer.alloc(sz);
		b.fill(0);
		b.write(cc, 0);//country code
		b.write(rg, 2);//region

		if(metro) {
			b.writeInt32BE(metro, 5);
		}
		b.write(eu,9);//is in eu
		b.write(tz,10);//timezone
		b.write(city, 34);//cityname

		fs.writeSync(datFile, b, 0, b.length, null);
		linesCount++;
	}

	var dataFile = path.join(dataPath, dest);
	var tmpDataFile = path.join(tmpPath, src);

	rimraf(dataFile);

	var datFile = fs.openSync(dataFile, "w");

	lazy(fs.createReadStream(tmpDataFile))
		.lines
		.map(function(byteArray) {
			return iconv.decode(byteArray, 'utf-8');
		})
		.skip(1)
		.map(processLine)
		.on('pipe', cb);
}

function processData(database, cb) {
	var type = database.type;
	var src = database.src;
	var dest = database.dest;

	if (type === 'country') {
		if(Array.isArray(src)){
			processLookupCountry(src[0], function() {
				processCountryData(src[1], dest[1], function() {
					processCountryData(src[2], dest[2], cb);
				});
			});
		}
		else{
			processCountryData(src, dest, cb);
		}
	} else if (type === 'city') {
		processCityDataNames(src[0], dest[0], function() {
			processCityData(src[1], dest[1], function() {
				console.log("city data processed");
				processCityData(src[2], dest[2], function() {
					console.log(' DONE'.green);
					cb();
				});
			});
		});
	}
}

if (!license_key || license_key === "true") {
	console.log('No GeoLite2 License Key Provided, Please Provide Argument: `--license_key=`'.yellow);
	process.exit(1);
}

rimraf(tmpPath);
mkdir(tmpPath);

async.eachSeries(databases, function(database, nextDatabase) {
	if (database.type.indexOf('city') !== -1) return nextDatabase();
	async.seq(fetch, extract, processData)(database, nextDatabase);
}, function(err) {
	if (err) {
		console.log('Failed to Update Databases from MaxMind.'.red);
		process.exit(1);
	} else {
		console.log('Successfully Updated Databases from MaxMind.'.green);
		if (process.argv[2] == 'debug') console.log('Notice: temporary files are not deleted for debug purposes.'.bold.yellow);
		else setTimeout(function(){rimraf(tmpPath);}, 100);
	}
});
