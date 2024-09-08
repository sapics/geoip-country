// fetches and converts maxmind lite databases

'use strict'

var user_agent = 'Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/39.0.2171.36 Safari/537.36'
var download_server = process.env.npm_config_geolite2_download_url || process.env.GEOLITE2_DOWNLOAD_URL
										|| process.env.npm_config_geoip_download_url || process.env.GEOIP_DOWNLOAD_URL
										|| 'https://download.maxmind.com/app/geoip_download'
var license_key = process.env.npm_config_license_key || process.env.GEOLITE2_LICENSE_KEY || null
var geodatadir = process.env.npm_config_geoip_datadir || process.env.GEOIP_DATADIR
								|| process.env.npm_config_geodatadir || process.env.GEODATADIR // alias for older version
var tmpdatadir = process.env.npm_config_geoip_tmpdatadir || process.env.GEOIP_TMPDATADIR
								|| process.env.npm_config_geotmpdatadir || process.env.GEOTMPDATADIR // alias for older version
var ip_location_db = process.env.npm_config_ip_location_db || process.env.IP_LOCATION_DB || null
var series = process.env.npm_config_geoip_series || process.env.GEOIP_SERIES
var language = process.env.npm_config_geoip_language || process.env.GEOIP_LANGUAGE || 'en'
var isDebug = process.argv.indexOf('debug') >= 0
var addFakeData = process.env.npm_config_geoip_fake_data || process.env.GEOIP_FAKE_DATA || false
var unusedFields = process.env.npm_config_geoip_unused_fields || process.env.GEOIP_UNUSED_FIELDS
var useRedist = process.env.npm_config_geoip_use_redist || process.env.GEOIP_USE_REDIST || false
for(var i = 0; i < process.argv.length; ++i){
	var arg = process.argv[i]
	if(isDebug) console.log(arg)
	if(arg.indexOf('license_key=') >= 0 && !license_key){
		license_key = arg.slice(arg.indexOf('=') + 1)
	} else if((arg.indexOf('geoip_datadir=') >= 0 || arg.indexOf('geodatadir=') >= 0) && !geodatadir){
		geodatadir = arg.slice(arg.indexOf('=') + 1)
	} else if((arg.indexOf('geoip_tmpdatadir=') >= 0 || arg.indexOf('geotmpdatadir=') >= 0) && !tmpdatadir){
		tmpdatadir = arg.slice(arg.indexOf('=') + 1)
	} else if(arg.indexOf('ip_location_db=') >= 0) {
		ip_location_db = arg.slice(arg.indexOf('=') + 1).replace('-country', '')
	} else if(arg.indexOf('geoip_series=') >= 0){
		series = arg.slice(arg.indexOf('=') + 1)
	} else if(arg.indexOf('geoip_language=') >= 0){
		language = arg.slice(arg.indexOf('=') + 1)
	} else if(arg.indexOf('geoip_fake_data=') >= 0){
		addFakeData = arg.slice(arg.indexOf('=') + 1) > 0
	} else if(arg.indexOf('geoip_unused_fields=') >= 0){
		unusedFields = arg.slice(arg.indexOf('=') + 1)
	}
}

if(!series){
	series = 'GeoLite2'
}
if(unusedFields){
	unusedFields = unusedFields.split(',')
} else {
	unusedFields = []
}

const fs = require('fs')
const https = require('https')
const path = require('path')
const url = require('url')

const isCountry = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'))).name.includes('country')
const async = require('async')
const readline = require('readline')
const yauzl = require('yauzl')
const utils = require('../lib/utils')
const Address6 = require('ip-address').Address6
const Address4 = require('ip-address').Address4

var dataPath, tmpPath
function rimraf(dir){
	try{
		var dirStat = fs.statSync(dir)
		if(dirStat.isDirectory()){
			var list = fs.readdirSync(dir)
			for(var i = 0; i < list.length; ++i){
				rimraf(path.join(dir, list[i]))
			}
			fs.rmdirSync(dir)
		} else {
			fs.unlinkSync(dir)
		}
	}catch(e){}
}

if(geodatadir){
	dataPath = path.resolve(process.cwd(), geodatadir)
} else {
 dataPath = path.resolve(__dirname, '..', 'data')
}
if(tmpdatadir){
	tmpPath = path.resolve(process.cwd(), tmpdatadir)
} else {
	tmpPath = path.resolve(__dirname, '..', 'tmp')
}

var countryLookup = {}
var cityLookup = {}
var databases = [
	{
		type: 'country',
		edition: series+'-Country-CSV',
		suffix: 'zip.sha256',
		src: [
			series+'-Country-Locations-en.csv',
			series+'-Country-Blocks-IPv4.csv',
			series+'-Country-Blocks-IPv6.csv'
		],
		dest: [
			'',
			'geoip-country.dat',
			'geoip-country6.dat'
		]
	},
	{
		type: 'city',
		edition: series+'-City-CSV',
		suffix: 'zip.sha256',
		src: [
			series+'-City-Locations-' + language + '.csv',
			series+'-City-Blocks-IPv4.csv',
			series+'-City-Blocks-IPv6.csv'
		],
		dest: [
			'geoip-city-names.dat',
			'geoip-city.dat',
			'geoip-city6.dat'
		]
	}
]

function mkdir(name) {
	var dir = path.dirname(name)
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir)
	}
}

// Ref: http://stackoverflow.com/questions/8493195/how-can-i-parse-a-csv-string-with-javascript
// Return array of string values, or NULL if CSV string not well formed.
// Return array of string values, or NULL if CSV string not well formed.

function try_fixing_line(line) {
	var pos1 = 0
	var pos2 = -1
	// escape quotes
	line = line.replace(/""/,'\\"').replace(/'/g,"\\'")

	while(pos1 < line.length && pos2 < line.length) {
		pos1 = pos2
		pos2 = line.indexOf(',', pos1 + 1)
		if(pos2 < 0) pos2 = line.length
		if(line.indexOf("'", (pos1 || 0)) > -1 && line.indexOf("'", pos1) < pos2 && line[pos1 + 1] != '"' && line[pos2 - 1] != '"') {
			line = line.substr(0, pos1 + 1) + '"' + line.substr(pos1 + 1, pos2 - pos1 - 1) + '"' + line.substr(pos2, line.length - pos2)
			pos2 = line.indexOf(',', pos2 + 1)
			if(pos2 < 0) pos2 = line.length
		}
	}
	return line
}

function CSVtoArray(text) {
	var re_valid = /^\s*(?:'[^'\\]*(?:\\[\S\s][^'\\]*)*'|"[^"\\]*(?:\\[\S\s][^"\\]*)*"|[^,'"\s\\]*(?:\s+[^,'"\s\\]+)*)\s*(?:,\s*(?:'[^'\\]*(?:\\[\S\s][^'\\]*)*'|"[^"\\]*(?:\\[\S\s][^"\\]*)*"|[^,'"\s\\]*(?:\s+[^,'"\s\\]+)*)\s*)*$/
	var re_value = /(?!\s*$)\s*(?:'([^'\\]*(?:\\[\S\s][^'\\]*)*)'|"([^"\\]*(?:\\[\S\s][^"\\]*)*)"|([^,'"\s\\]*(?:\s+[^,'"\s\\]+)*))\s*(?:,|$)/g
	// Return NULL if input string is not well formed CSV string.
	if (!re_valid.test(text)){
		text  = try_fixing_line(text)
		if(!re_valid.test(text))
			return null
	}
	var a = []; // Initialize array to receive values.
	text.replace(re_value, // "Walk" the string using replace with callback.
		function(m0, m1, m2, m3) {
			// Remove backslash from \' in single quoted values.
			if      (m1 !== undefined) a.push(m1.replace(/\\'/g, "'"))
			// Remove backslash from \" in double quoted values.
			else if (m2 !== undefined) a.push(m2.replace(/\\"/g, '"').replace(/\\'/g, "'"))
			else if (m3 !== undefined) a.push(m3)
			return ''; // Return empty string.
		})
	// Handle special case of empty last value.
	if (/,\s*$/.test(text)) a.push('')
	return a
}

var RedistDownloadUrl = 'https://raw.githubusercontent.com/sapics/node-geolite2-redist/master/redist/'
function downloadDatabase(database, cb) {
	var downloadUrl, fileName
	if(typeof database === 'string') {
		// for ip-location-db
		downloadUrl = database
		fileName = path.basename(downloadUrl)
	} else {
		if(useRedist){
			downloadUrl = RedistDownloadUrl + database.edition + '.' + database.suffix
		} else {
			// for maxmind
			downloadUrl = download_server + '?edition_id=' + database.edition + '&suffix=' + database.suffix + "&license_key=" + encodeURIComponent(license_key)
		}
		fileName = database.edition + '.' + database.suffix
		console.log('Fetching edition ' + database.edition + ' from ' + download_server)
	}

	var tmpFile = path.join(tmpPath, fileName)
	if (fs.existsSync(tmpFile)) {
		return cb(null, tmpFile, fileName, database)
	}

	function getOptions(redirectUrl) {
		var options = url.parse(redirectUrl || downloadUrl)
		options.headers = {
			'User-Agent': user_agent
		}

		if (process.env.http_proxy || process.env.https_proxy) {
			try {
				var HttpsProxyAgent = require('https-proxy-agent')
				options.agent = new HttpsProxyAgent(process.env.http_proxy || process.env.https_proxy)
			}
			catch (e) {
				console.error("Install https-proxy-agent to use an HTTP/HTTPS proxy")
				process.exit(-1)
			}
		}

		return options
	}

	function onResponse(response) {
		var status = response.statusCode

		if (status === 301 || status === 302 || status === 303 || status === 307 || status === 308) {
			return https.get(getOptions(response.headers.location), onResponse)
		} else if (status !== 200) {
			if (status === 401) {
				console.log('ERROR' + ': Download Not Allowed — Is Your License Key Valid? [HTTP %d]', status)
			} else {
				console.log('ERROR' + ': HTTP Request Failed [%d]', status)
			}

			client.abort()
			process.exit(1)
		}

		if(typeof database === 'string' || database.suffix === 'zip') {
			var tmpFileStream = fs.createWriteStream(tmpFile, {highWaterMark: 1024 * 1024})
			response.pipe(tmpFileStream).on('close', function() {
				console.log(' DOWNLOAD DONE', fileName)
				cb(null, tmpFile, fileName, database)
			})
		} else {
			var oldSha256 = fs.readFileSync(path.join(dataPath, fileName), 'utf8')

			var sha256 = ''
			response.on('data', function(chunk) {
				sha256 += chunk
			})
			response.on('end', function() {
				sha256 = sha256.trim().replace(/\s+[^\s]+$/, '')
				if(!sha256){
					console.log('ERROR to CHECK sha256')
					process.exit(1)
				}
				if(oldSha256 === sha256){
					console.log('Already up to date')
					return cb(new Error('Already up to date'))
				}
				database.suffix = database.suffix.replace('.sha256', '')
				fs.writeFileSync(path.join(dataPath, fileName), sha256)
				downloadDatabase(database, cb)
			})
		}
	}

	mkdir(tmpFile)
	var client = https.get(getOptions(), onResponse)

	process.stdout.write('Retrieving ' + fileName + ' ...')
}

function extract(tmpFile, tmpFileName, database, cb) {
	if (path.extname(tmpFileName) !== '.zip') {
		cb(null, database)
	} else {
		process.stdout.write('Extracting ' + tmpFileName + ' ...')
		yauzl.open(tmpFile, {autoClose: true, lazyEntries: true}, function(err, zipfile) {
			if (err) {
				throw err
			}
			zipfile.readEntry()
			zipfile.on("entry", function(entry) {
				if (/\/$/.test(entry.fileName)) {
					// Directory file names end with '/'.
					// Note that entries for directories themselves are optional.
					// An entry's fileName implicitly requires its parent directories to exist.
					zipfile.readEntry()
				} else {
					// file entry
					zipfile.openReadStream(entry, function(err, readStream) {
						if (err) {
							throw err
						}
						readStream.on("end", function() {
							zipfile.readEntry()
						})
						var filePath = entry.fileName.split("/")
						// filePath will always have length >= 1, as split() always returns an array of at least one string
						var fileName = filePath[filePath.length - 1]
						readStream.pipe(fs.createWriteStream(path.join(tmpPath, fileName)))
					})
				}
			})
			zipfile.once("end", function() {
				cb(null, database)
			})
		})
	}
}
function processLookupCountry(src, cb){
	var isFirstLine = true
	function processLine(line) {
		if(isFirstLine){
			isFirstLine = false
			return
		}
		var fields = CSVtoArray(line)
		if (!fields || fields.length < 6) {
			console.log("weird line: %s::", line)
			return
		}
		countryLookup[fields[0]] = fields[4]
	}
	var tmpDataFile = path.join(tmpPath, src)

	process.stdout.write('Processing Lookup Data (may take a moment) ...')

	var rl = readline.createInterface({
		input: fs.createReadStream(tmpDataFile),
		crlfDelay: Infinity
	})
	rl.on('line', processLine)
	rl.on('close', function(){
		console.log(' DONE')
		cb()
	})
}

function processCountryData(src, dest, cb) {
	var preCC, preB, preEip = 0, isFirstLine = true
	function processLine(line) {
		if(isFirstLine){
			isFirstLine = false
			return
		}
		var fields = CSVtoArray(line)

		if (!fields || fields.length < 6) {
			console.log("weird line: %s::", line)
			return
		}

		var sip
		var eip
		var rngip
		var cc = countryLookup[fields[1]]
		var b
		var bsz
		var isNew = false
		if(!cc || cc.length !== 2) return;
		if (fields[0].includes(':')) {
			// IPv6
			bsz = 18
			rngip = new Address6(fields[0])
			sip = utils.aton6(rngip.startAddress().correctForm())
			eip = utils.aton6(rngip.endAddress().correctForm())

			if(isDebug && preEip){
				if(preEip === sip) {
					console.log('same ipv6 country range!!!')
				}
			}

			if (cc === preCC && !addFakeData) {
				if(preEip + 1n !== sip) {
					preCC = null
				}
			}

			if (cc !== preCC) {
				isNew = true
				b = Buffer.alloc(bsz)
				b.writeBigUInt64BE(sip)
			} else {
				b = preB
			}
			b.writeBigUInt64BE(eip, 8)

		} else {
			// IPv4
			bsz = 10

			rngip = new Address4(fields[0])
			sip = parseInt(rngip.startAddress().bigInteger(),10)
			eip = parseInt(rngip.endAddress().bigInteger(),10)

			if (preEip + 1 !== sip && !addFakeData) {
				preCC = null
			}
			if (cc !== preCC) {
				isNew = true
				b = Buffer.alloc(bsz)
				b.writeUInt32BE(sip, 0)
				b.writeUInt32BE(eip, 4)
			}	else {
				preB.writeUInt32BE(eip, 4)
			}
		}

		if(isNew){
			if(preB){
				if(!datFile.write(preB)){
					rl.pause()
				}
			}
			b.write(cc, bsz - 2)
			preB = b
		}
		preCC = cc
		preEip = eip
	}

	var dataFile = path.join(dataPath, dest)
	var tmpDataFile = path.join(tmpPath, src)

	rimraf(dataFile)
	mkdir(dataFile)

	process.stdout.write('Processing Data (may take a moment) ...')
	var datFile = fs.createWriteStream(dataFile, {highWaterMark: 1024 * 1024})
	var rl = readline.createInterface({
		input: fs.createReadStream(tmpDataFile, {highWaterMark: 1024 * 1024}),
		crlfDelay: Infinity
	})
	rl.on('line', processLine)
	rl.on('pause', function(){
		datFile.once('drain', function(){
			rl.resume()
		})
	})
	rl.on('close', function(){
		console.log(' DONE')
		datFile.end(preB, cb)
	})
}

function processCountryDataIpLocationDb(src, fileName, srcUrl, cb) {
	function processLine(line) {
		var fields = line.split(',')
		if (!fields || fields.length < 3) {
			console.log("weird line: %s::", line)
			return
		}

		var sip
		var eip
		var cc = fields[2]
		var b
		var bsz
		if(!cc || cc.length !== 2) return;
		if (src.indexOf('ipv6') > 0) {
			// IPv6
			bsz = 18
			sip = utils.aton6(fields[0])
			eip = utils.aton6(fields[1])

			b = Buffer.alloc(bsz)
			b.writeBigUInt64BE(sip)
			b.writeBigUInt64BE(eip, 8)
		} else {
			// IPv4
			bsz = 10
			sip = utils.aton4(fields[0])
			eip = utils.aton4(fields[1])

			b = Buffer.alloc(bsz)
			b.writeUInt32BE(sip, 0)
			b.writeUInt32BE(eip, 4)
		}

		b.write(cc, bsz - 2)
		if(!datFile.write(b)){
			rl.pause()
		}
	}

	var dest
	if(src.indexOf('ipv4') > 0){
		dest = 'geoip-country.dat'
	} else {
		dest = 'geoip-country6.dat'
	}
	var dataFile = path.join(dataPath, dest)

	rimraf(dataFile)

	process.stdout.write('Processing Data (may take a moment) ...')
	var datFile = fs.createWriteStream(dataFile, {highWaterMark: 1024 * 1024})
	var rl = readline.createInterface({
		input: fs.createReadStream(src, {highWaterMark: 1024 * 1024}),
		crlfDelay: Infinity
	})
	rl.on('line', processLine)
	rl.on('pause', function(){
		datFile.once('drain', function(){
			rl.resume()
		})
	})
	rl.on('close', function(){
		console.log(' DONE')
		datFile.end(cb)
	})
}

var isPostNumReg = /^\d+$/
var isPostNumReg2 = /^(\d+)[-\s](\d+)$/
var isPostStrReg = /^([A-Z\d]+)$/
var isPostStrReg2 = /^([A-Z\d]+)[-\s]([A-Z\d]+)$/
function postcodeDatabase(postcode){
	// number type
	if(isPostNumReg.test(postcode)){
		return [postcode.length, // 1~9
						parseInt(postcode, 10) // 0~999999999
					]
	}
	var r = isPostNumReg2.exec(postcode)
	if(r){
		return [
			parseInt(r[1].length + '' + r[2].length, 10), // 11~66
			parseInt(r[1] + r[2], 10) // 0~999999999
		]
	}

	// string type
	r = isPostStrReg.exec(postcode)
	if(r){
		var num = parseInt(postcode, 36)
		if(num < Math.pow(2, 32)){
			return [
				0,
				num
			]
		} else {
			var num1 = parseInt('2' + postcode.slice(0, 1), 36) // 72~107
			var num2 = parseInt(postcode.slice(1), 36) // 0~2176782335 MAX: 6char ZZZZZZ
			return [
				num1,
				num2,
			]
		}
	}

	r = isPostStrReg2.exec(postcode)
	var num1 = - parseInt(r[1].length + "" + r[2].length, 10)// -11~-55
	var num2 = parseInt(r[1] + r[2], 36) // 0~2176782335 MAX: 6char ZZZZZZ
	return [
		num1,
		num2
	]
}

function processCityData(src, dest, cb) {
	var isFirstLine = true
	var preLocId, preB, preEip = 0, preLat, preLon, prePostcode
	var unusedSize = utils.fieldsSize(unusedFields)
	var ipv6Size = 35 - unusedSize, ipv4Size = 27 - unusedSize
	function processLine(line) {
		if(isFirstLine){
			isFirstLine = false
			return
		}

		var fields = CSVtoArray(line)
		if (!fields) {
			console.log("weird line: %s::", line)
			return
		}
		var sip, eip
		var rngip
		var locId
		var b
		var bsz
		var lat, lon, area
		var postcode, offset
		var isNew = true

		locId = parseInt(fields[1], 10)
		locId = cityLookup[locId]
		lat = Math.round(parseFloat(fields[7]) * 10000)
		lon = Math.round(parseFloat(fields[8]) * 10000)
		area = fields[9]
		postcode = fields[6] && postcodeDatabase(fields[6])

		if(preLocId === locId && preLat === lat && preLon === lon && prePostcode[0] === postcode[0] && prePostcode[1] === postcode[1]){
			isNew = false
		}

		if (fields[0].match(/:/)) {
			// IPv6
			bsz = ipv6Size
			rngip = new Address6(fields[0])
			sip = utils.aton6(rngip.startAddress().correctForm())
			eip = utils.aton6(rngip.endAddress().correctForm())

			if(isDebug && preEip){
				if(preEip === sip) {
					console.log('same ipv6 city range!!!')
				}
			}

			if(!isNew && !addFakeData){
				if(preEip + 1n !== sip){
					isNew = true
				}
			}
			if(isNew){
				b = Buffer.alloc(bsz)
				b.writeBigUInt64BE(sip)
				b.writeBigUInt64BE(eip, 8)
				offset = 20
			} else {
				preB.writeBigUInt64BE(eip, 8)
			}
		} else {
			// IPv4
			bsz = ipv4Size

			rngip = new Address4(fields[0])
			sip = parseInt(rngip.startAddress().bigInteger(),10)
			eip = parseInt(rngip.endAddress().bigInteger(),10)

			if(!isNew && !addFakeData){
				if(preEip + 1 !== sip){
					isNew = true
				}
			}
			if(isNew){
				locId = parseInt(fields[1], 10)
				locId = cityLookup[locId]
				b = Buffer.alloc(bsz)
				b.writeUInt32BE(sip>>>0, 0); // ip start [4 bytes]
				b.writeUInt32BE(eip>>>0, 4); // ip end [4 bytes]
				offset = 12
			} else {
				preB.writeUInt32BE(eip>>>0, 4)
			}
		}

		if(isNew){
			b.writeUInt32BE(locId>>>0, offset - 4)
			if(!unusedFields.includes('latitude')){
				b.writeInt32BE(lat, offset)
				offset += 4
			}
			if(!unusedFields.includes('longitude')){
				b.writeInt32BE(lon, offset)
				offset += 4
			}
			if(!unusedFields.includes('area')){
				b.writeUInt16BE(area, offset)
				offset += 2
			}
			if(!unusedFields.includes('postcode')){
				b.writeUInt32BE(postcode[1], offset)
				b.writeInt8(postcode[0], offset + 4)
			}
			if(preB){
				if(!datFile.write(preB)){
					rl.pause()
				}
			}
			preB = b
		}
		preLocId = locId
		preLat = lat
		preLon = lon
		prePostcode = postcode
		preEip = eip
	}

	var dataFile = path.join(dataPath, dest)
	var tmpDataFile = path.join(tmpPath, src)

	rimraf(dataFile)

	process.stdout.write('Processing Data (may take a moment) ...')
	var datFile = fs.createWriteStream(dataFile, {highWaterMark: 1024 * 1024})
	var rl = readline.createInterface({
		input: fs.createReadStream(tmpDataFile, {highWaterMark: 1024 * 1024}),
		crlfDelay: Infinity
	})
	rl.on('line', processLine)
	rl.on('pause', function(){
		datFile.once('drain', function(){
			rl.resume()
		})
	})
	rl.on('close', function(){
		console.log(' DONE')
		datFile.end(preB, cb)
	})
}

var subDatabase1 = {}, subCount1 = 0, subDatabase2 = {}, subCount2 = 0, timezoneDatabase = {}, timezoneCount = 0
var subCodeDatabase1 = {}, subCodeDatabase2 = {}
function makeTimezoneDatabase(timezone){
	if(timezoneDatabase[timezone]) return timezoneDatabase[timezone]
	return timezoneDatabase[timezone] = ++timezoneCount
}
function makeSubDatabase(cc, sub1_code, sub2_code, sub1_name, sub2_name){
	if(!sub1_code) return []
	var code = cc + '.' + sub1_code
	var indexes = []
	if(!subDatabase1[code]){
		subDatabase1[code] = [sub1_name, ++subCount1]
		subCodeDatabase1[code] = [sub1_code, subCount1]
	}
	indexes.push(subDatabase1[code][1])

	if(sub2_code){
		code += '.' + sub2_code
		if(!subDatabase2[code]){
			subDatabase2[code] = [sub2_name, ++subCount2]
			subCodeDatabase2[code] = [sub2_code, subCount2]
		}
		indexes.push(subDatabase2[code][1])
	}
	return indexes
}
var cityDatabase = {}, cityCount = 0
function makeCityDatabase(city){
	if(cityDatabase[city]) return cityDatabase[city]
	return cityDatabase[city] = ++cityCount
}

var enDatabase = {}, enDatabaseCreated = false
function processCityDataNamesEn(src, dest, cb) {
	var tmpDataFile = path.join(tmpPath, src.replace(/Locations-(.*)\.csv$/, 'Locations-en.csv'))
	function processLine(line) {
		var fields = CSVtoArray(line)
		var locId = parseInt(fields[0])
		if(locId > 0){
			enDatabase[locId] = fields
		}
	}
	var rl = readline.createInterface({
		input: fs.createReadStream(tmpDataFile),
		crlfDelay: Infinity
	})
	rl.on('line', processLine)
	rl.on('close', function(){
		console.log(' DONE')
		enDatabaseCreated = true
		processCityDataNames(src, dest, cb)
	})
}

function processCityDataNames(src, dest, cb) {
	if(!enDatabaseCreated && src.indexOf('-en') === -1){
		return processCityDataNamesEn(src, dest, cb)
	}

	var locId = null
	var linesCount = 0, isFirstLine = true
	function processLine(line) {
		if(isFirstLine){
			isFirstLine = false
			return
		}

		var b
		var sz = 14
		var fields = CSVtoArray(line)
		if (!fields) {
			//lot's of cities contain ` or ' in the name and can't be parsed correctly with current method
			console.log("weird line: %s::", line)
			return
		}

		locId = parseInt(fields[0])

		cityLookup[locId] = linesCount++

		var enFields = enDatabase[locId] || []
		var cc = fields[4]
		var sub1_code = fields[6]
		var sub2_code = fields[8]
		var city = fields[10] || enFields[10]
		var metro = parseInt(fields[11] || enFields[11], 10)
		var tz = fields[12] || enFields[12]
		var subIndexes = []

		if(sub1_code){
			subIndexes = makeSubDatabase(cc, sub1_code, sub2_code, fields[7]||enFields[7], fields[9]||enFields[9])
		}

		b = Buffer.alloc(sz)
		b.write(cc, 0);//country code [2 bytes]
		if(subIndexes.length){
			b.writeUInt16BE(subIndexes[0], 2);//subdivision code index[2 bytes]
			if(subIndexes.length > 1){
				b.writeUInt16BE(subIndexes[1], 4);//subdivision code index[2 bytes]
			}
		}
		if(metro) {
			b.writeUInt16BE(metro, 6); // metro code [2 bytes]
		}
		if(city){
			b.writeUInt32BE(makeCityDatabase(city), 8);//cityname index [4 bytes]
		}
		if(tz){
			b.writeUInt16BE(makeTimezoneDatabase(tz), 12);//timezone [2 byte]
		}

		if(!datFile.write(b)){
			rl.pause()
		}
	}

	var dataFile = path.join(dataPath, dest)
	var tmpDataFile = path.join(tmpPath, src)

	rimraf(dataFile)

	var datFile = fs.createWriteStream(dataFile, {highWaterMark: 1024 * 1024})
	var rl = readline.createInterface({
		input: fs.createReadStream(tmpDataFile, {highWaterMark: 1024 * 1024}),
		crlfDelay: Infinity
	})
	rl.on('line', processLine)
	rl.on('pause', function(){
		datFile.once('drain', function(){
			rl.resume()
		})
	})
	rl.on('close', function(){
		console.log(' DONE')
		enDatabase = null

		var hash = {}
		var tmpSub1 = [], tmpSub2 = []
		for(var key in subDatabase1){
			tmpSub1[subDatabase1[key][1]] = subDatabase1[key][0]
			tmpSub2[subDatabase1[key][1]] = subCodeDatabase1[key][0]
		}
		hash.state1 = tmpSub1, hash.region1 = tmpSub2
		subDatabase1 = subCodeDatabase1 = null

		tmpSub1 = [], tmpSub2 = []
		for(var key in subDatabase2){
			tmpSub2[subDatabase2[key][1]] = subDatabase2[key][0]
			tmpSub2[subDatabase2[key][1]] = subCodeDatabase2[key][0]
		}
		hash.state2 = tmpSub2, hash.region2 = tmpSub2
		subDatabase2 = subCodeDatabase2 = null

		var tmpCity = []
		for(var key in cityDatabase){
			tmpCity[cityDatabase[key]] = key
		}
		hash.city = tmpCity
		cityDatabase = null

		var tmpTimezone = []
		for(var key in timezoneDatabase){
			tmpTimezone[timezoneDatabase[key]] = key
		}
		hash.timezone = tmpTimezone
		timezoneDatabase = null

		fs.writeFileSync(path.join(dataPath, 'geoip-city-sub.json'), JSON.stringify(hash), 'utf8')
		tmpSub1 = tmpSub2 = tmpCity = tmpTimezone = null
		datFile.end(cb)
	})
}

function processData(database, cb) {
	var type = database.type
	var src = database.src
	var dest = database.dest

	if (type === 'country') {
		if(Array.isArray(src)){
			processLookupCountry(src[0], function() {
				processCountryData(src[1], dest[1], function() {
					processCountryData(src[2], dest[2], cb)
				})
			})
		}
		else{
			processCountryData(src, dest, cb)
		}
	} else if (type === 'city') {
		processCityDataNames(src[0], dest[0], function() {
			processCityData(src[1], dest[1], function() {
				console.log("city data processed")
				processCityData(src[2], dest[2], function() {
					console.log(' DONE')
					cb()
				})
			})
		})
	}
}

if(!isDebug){
	rimraf(tmpPath)
	mkdir(tmpPath)
}

if(ip_location_db){
	var preUrl = 'https://cdn.jsdelivr.net/npm/@ip-location-db/'+ip_location_db+'-country/'+ip_location_db+'-country'
	var ipv4Url = preUrl+'-ipv4.csv'
	var ipv6Url = preUrl+'-ipv6.csv'
	async.seq(downloadDatabase, processCountryDataIpLocationDb)(ipv4Url, function(err){
		if(err){
			console.log('Failed to Update Databases ip-location-db/' + ip_location_db)
			process.exit(1)
		}
		async.seq(downloadDatabase, processCountryDataIpLocationDb)(ipv6Url, function(err){
			if(err){
				console.log('Failed to Update Databases ip-location-db/' + ip_location_db)
				process.exit(1)
			}
			console.log('Successfully Updated Database.')
			process.exit(0)
		})
	})
} else {
	if(!isDebug){
		if (!license_key || license_key === "true") {
			if(!useRedist){
				console.log('No GeoLite2 License Key Provided, Please Provide Argument: `--license_key=`')
				process.exit(1)
			}
		}
	}

	console.log('Fetching new databases from MaxMind...')
	console.log('Storing files at ' + dataPath)

	async.eachSeries(databases, function(database, nextDatabase) {
		if(isDebug){
			async.seq(processData)(database, nextDatabase)
		} else {
			if(isCountry){
				if(database.type !== 'country') return nextDatabase()
			} else {
				if(database.type === 'country') return nextDatabase()
			}
			async.seq(downloadDatabase, extract, processData)(database, nextDatabase)
		}
	}, function(err) {
		if (err) {
			console.log('Failed to Update Databases from MaxMind.')
			process.exit(1)
		} else {
			console.log('Successfully Updated Databases from MaxMind.')
			if (isDebug) console.log('Notice: temporary files are not deleted for debug purposes.')
			else rimraf(tmpPath)
			process.exit(0)
		}
	})
}
