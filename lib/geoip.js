const fs = require('fs')
const net = require('net')
const path = require('path')
const exec = require('child_process').exec

const utils = require('./utils')
const fsWatcher = require('./fsWatcher')
const isCountry = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'))).name.includes('country')
var watcherName = 'dataWatcher'

var geodatadir = global.geoip_datadir || process.env.npm_config_geoip_datadir || process.env.GEOIP_DATADIR
							|| global.geodatadir || process.env.npm_config_geodatadir || process.env.GEODATADIR; // alias for older version
var unusedFields = global.geoip_unused_fields || process.env.npm_config_geoip_unused_fields || process.env.GEOIP_UNUSED_FIELDS
var fastLookup = global.geoip_fast_lookup || process.env.npm_config_geoip_fast_lookup || process.env.GEOIP_FAST_LOOKUP
var cityRecordSizeChange = 0
if(!geodatadir && process.argv) {
	for(var i = 0; i < process.argv.length; ++i){
		var arg = process.argv[i]
		if(arg.indexOf('geoip_datadir=') >= 0 || arg.indexOf('geodatadir=') >= 0){
			geodatadir = arg.slice(arg.indexOf('=') + 1)
		} else if(arg.indexOf('geoip_unused_fields=') >= 0){
			unusedFields = arg.slice(arg.indexOf('=') + 1)
		} else if(arg.indexOf('geoip_fast_lookup=') >= 0){
			fastLookup = arg.slice(arg.indexOf('=') + 1)
		}
	}
}
geodatadir = path.resolve(
	__dirname,
	geodatadir || '../data/'
)

if(unusedFields){
	unusedFields = unusedFields.split(',')
	cityRecordSizeChange = utils.fieldsSize(unusedFields)
} else {
	unusedFields = []
}

const COUNTRY_RECORD_SIZE = 10
const COUNTRY_RECORD_SIZE6 = 18
var cache4 = {recordSize: isCountry ? COUNTRY_RECORD_SIZE  : COUNTRY_RECORD_SIZE  + 17 - cityRecordSizeChange}
var cache6 = {recordSize: isCountry ? COUNTRY_RECORD_SIZE6 : COUNTRY_RECORD_SIZE6 + 17 - cityRecordSizeChange}

var state1Json, region1Json, state2Json, region2Json
var cityJson, timezoneJson
var countryJson = require('countries-list')
var continentJson = countryJson.continents
countryJson = countryJson.countries

function getZeroFill(str, len){
	while(str.length < len){
		str = '0' + str
	}
	return str
}
function setCityRecord(buffer, geodata, offset, locBuffer){
	var locId = buffer.readUInt32BE(offset)
	offset += 4
	if(-1 >>> locId){
		var locOffset = locId * 14
		geodata.country = locBuffer.toString('utf8', locOffset, locOffset += 2)
		var sub1 = locBuffer.readUInt16BE(locOffset)
		locOffset += 2
		if(sub1 > 0) {
			geodata.region1 = region1Json[sub1]
			geodata.state1 = state1Json[sub1]
		}
		var sub2 = locBuffer.readUInt16BE(locOffset)
		locOffset += 2
		if(sub2 > 0) {
			geodata.region2 = region2Json[sub2]
			geodata.state2 = state2Json[sub2]
		}
		var metro = locBuffer.readUInt16BE(locOffset)
		locOffset += 2
		if(metro > 0) geodata.metro = metro
		var city = locBuffer.readUInt32BE(locOffset)
		locOffset += 4
		if(city > 0) geodata.city = cityJson[city]
		var timezone = locBuffer.readUInt16BE(locOffset)
		if(timezone > 0) geodata.timezone = timezoneJson[timezone]
	}

	if(!unusedFields.includes('latitude')){
		geodata.latitude = buffer.readInt32BE(offset) / 10000
		offset += 4
	}
	if(!unusedFields.includes('longitude')){
		geodata.longitude = buffer.readInt32BE(offset) / 10000
		offset += 4
	}
	if(!unusedFields.includes('area')){
		geodata.area = buffer.readUInt16BE(offset)
		offset += 2
	}
	if(!unusedFields.includes('postcode')){
		var postcode2 = buffer.readUInt32BE(offset)
		var postcode1 = buffer.readInt8(offset + 4)
		if (postcode2) {
			var postcode, tmp
			if(postcode1 === 0){
				postcode = postcode2.toString(36)
			} else if(postcode1 < 0){
				tmp = (-postcode1).toString()
				postcode = postcode2.toString(36)
				postcode = getZeroFill(postcode.slice(0, -tmp[1]), tmp[0]-0) + '-' + getZeroFill(postcode.slice(-tmp[1]), tmp[1]-0)
			} else if(postcode1 < 10){
				postcode = getZeroFill(postcode2.toString(10), postcode1)
			} else if(postcode1 < 72){
				postcode1 = String(postcode1)
				postcode = getZeroFill(postcode2.toString(10), (postcode1[0]-0) + (postcode1[1]-0))
				postcode = postcode.slice(0, postcode1[0]-0) + '-' + postcode.slice(postcode1[0]-0)
			} else {
				postcode = postcode1.toString(36).slice(1) + postcode2.toString(36)
			}
			geodata.postcode = postcode.toUpperCase()
		}
	}
}

function setCountryInfo(geodata){
	if(countryJson[geodata.country]){
		Object.assign(geodata, countryJson[geodata.country])
		if(geodata.continent && continentJson[geodata.continent]){
			geodata.continent_name = continentJson[geodata.continent]
		}
	}
	return geodata
}

fastLookup = parseInt(fastLookup||0, 10)
if(!fastLookup) fastLookup = 12
else if(fastLookup < 4) fastLookup = 4
else if(fastLookup > 18) fastLookup = 18
const fastLookupNum = Math.pow(2, fastLookup)

function lookup4(ip) {
	var fline, cline = cache4.lastLine
	var line, offset
	var buffer = cache4.mainBuffer
	var recordSize = cache4.recordSize
	var geodata = {}

	var start = 0, end = fastLookupNum, mid, list = cache4.middleIps
	for(var j = 0; j < fastLookup; ++j){
		mid = start + end >> 1
		if(ip < list[mid]){
			end = mid
		} else {
			start = mid
		}
	}
	fline = cline * start / fastLookupNum | 0
	cline = cline * end / fastLookupNum | 0

	for(;;) {
		line = fline + cline >> 1
		if(buffer.readUInt32BE(offset = line * recordSize) > ip){
			if(cline === line){
				return null
			}
			cline = line
			continue
		}
		if (buffer.readUInt32BE(offset + 4) < ip) {
			if(fline === line){
				if(cline === line){
					return null
				}
				++fline
			} else {
				fline = line
			}
			continue
		}
		offset += 8
		if(isCountry){
			geodata.country = buffer.toString('utf8', offset, offset + 2)
		} else {
			setCityRecord(buffer, geodata, offset, cache4.locBuffer)
		}
		return setCountryInfo(geodata)
	}
}

function lookup6(ip) {
	var fline, cline = cache6.lastLine
	var line, offset
	var recordSize = cache6.recordSize
	var buffer = cache6.mainBuffer
	var geodata = {}

	var start = 0, end = fastLookupNum, mid, list = cache6.middleIps
	for(var j = 0; j < fastLookup; ++j){
		mid = start + end >> 1
		if(ip < list[mid]){
			end = mid
		} else {
			start = mid
		}
	}
	fline = cline * start / fastLookupNum | 0
	cline = cline * end / fastLookupNum | 0

	for(;;) {
		line = fline + cline >> 1
		if(buffer.readBigUInt64BE(offset = line * recordSize) > ip){
			if(cline === line) {
				return null
			}
			cline = line
			continue
		}

		if(buffer.readBigUInt64BE(offset + 8) < ip){
			if(fline === line) {
				if(cline === line) {
					return null
				}
				++fline
			} else {
				fline = line
			}
			continue
		}

		offset += 16
		if(isCountry){
			geodata.country = cache6.mainBuffer.toString('utf8', offset, offset + 2)
		} else {
			setCityRecord(cache6.mainBuffer, geodata, offset, cache4.locBuffer)
		}
		return setCountryInfo(geodata)
	}
}

function get4mapped(ip) {
  var ipv6 = ip.toUpperCase()
  var v6prefixes = ['0:0:0:0:0:FFFF:', '::FFFF:']
  for (var i = 0; i < v6prefixes.length; i++) {
		var v6prefix = v6prefixes[i]
		if (ipv6.startsWith(v6prefix)) {
			return ipv6.substring(v6prefix.length)
		}
  }
  return null
}

function preload(cb) {
	var dataFiles = {
		city: path.join(geodatadir, 'geoip-city.dat'),
		city6: path.join(geodatadir, 'geoip-city6.dat'),
		cityNames: path.join(geodatadir, 'geoip-city-names.dat'),
		country: path.join(geodatadir, 'geoip-country.dat'),
		country6: path.join(geodatadir, 'geoip-country6.dat')
	}

	if(cb){
		var locBuffer, mainBuffer, mainBuffer6, subBuffer
		function setData(){
			cache4.mainBuffer = mainBuffer
			cache4.lastLine = (mainBuffer.length / cache4.recordSize) - 1
			cache6.mainBuffer = mainBuffer6
			cache6.lastLine = (mainBuffer6.length / cache6.recordSize) - 1
			setMiddleLines(true), setMiddleLines(false)
			if(!isCountry){
				cache4.locBuffer = locBuffer
				var tmpJson = JSON.parse(subBuffer)
				state1Json = tmpJson.state1
				state2Json = tmpJson.state2
				region1Json = tmpJson.region1
				region2Json = tmpJson.region2
				cityJson = tmpJson.city
				timezoneJson = tmpJson.timezone
			}
			cb()
		}

		// read ipv4
		fs.readFile(isCountry ? dataFiles.country : dataFiles.city, function(err, data){
			if(err) return cb(err)
			mainBuffer = data
			fs.readFile(isCountry ? dataFiles.country6 : dataFiles.city6, function(err, data){
				if(err) return cb(err)
				mainBuffer6 = data
				if(isCountry) return setData()
				// read city names
				fs.readFile(dataFiles.cityNames, function(err, data){
					if(err) return cb(err)
					locBuffer = data
					fs.readFile(path.join(geodatadir, 'geoip-city-sub.json'), 'utf-8', function(err, data){
						if(err) return cb(err)
						subBuffer = data
						setData()
					})
				})
			})
		})
	} else {
		cache4.mainBuffer = fs.readFileSync(isCountry ? dataFiles.country : dataFiles.city)
		cache4.lastLine = (cache4.mainBuffer.length / cache4.recordSize) - 1
		cache6.mainBuffer = fs.readFileSync(isCountry ? dataFiles.country6 : dataFiles.city6)
		cache6.lastLine = (cache6.mainBuffer.length / cache6.recordSize) - 1
		setMiddleLines(true), setMiddleLines(false)
		if(!isCountry){
			cache4.locBuffer = fs.readFileSync(dataFiles.cityNames)
			var tmpJson = JSON.parse(fs.readFileSync(path.join(geodatadir, 'geoip-city-sub.json')))
			state1Json = tmpJson.state1
			state2Json = tmpJson.state2
			region1Json = tmpJson.region1
			region2Json = tmpJson.region2
			cityJson = tmpJson.city
			timezoneJson = tmpJson.timezone
		}
	}
}

preload()

function setMiddleLines(ipv4){
	var cache = ipv4 ? cache4 : cache6, buffer = cache.mainBuffer
	var lastLine = cache.lastLine, record, recordSize = cache.recordSize
	var list = ipv4 ? new Uint32Array(fastLookupNum) : new BigUint64Array(fastLookupNum)
	for(var i = 1; i < fastLookupNum; i++){
		record = (lastLine * i / fastLookupNum | 0) * recordSize
		list[i] = ipv4 ? buffer.readUInt32BE(record) : buffer.readBigUInt64BE(record)
	}
	cache.middleIps = list
}

module.exports = {
	lookup: function(ip) {
		var ipv = net.isIP(ip)
		if (ipv === 4) {
			return lookup4(utils.aton4(ip))
		}
		if (ipv === 6) {
			var ipv4 = get4mapped(ip)
			if (ipv4) {
				return lookup4(utils.aton4(ipv4))
			} else {
				return lookup6(utils.aton6(ip))
			}
		}
		if (typeof ip === 'number') {
			return lookup4(ip)
		}
		return null
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
				return callback(error, stdout, stderr)
			}
			//Reload data
			preload(callback)
		})
	},

	// Start watching for data updates. The watcher waits one minute for file transfer to
	// completete before triggering the callback.
	startWatchingDataUpdate: function (callback) {
		fsWatcher.makeFsWatchFilter(watcherName, geodatadir, 60*1000, function () {
			preload(callback)
		})
	},

	// Stop watching for data updates.
	stopWatchingDataUpdate: function () {
		fsWatcher.stopWatching(watcherName)
	},

	// clear data
	clear: function(){
		cache4 = {recordSize: cache4.recordSize}
		cache6 = {recordSize: cache6.recordSize}
	},

	// Reload data synchronously
	reloadDataSync: function(){
		preload()
	},

	// Reload data asynchronously
	reloadData: function(callback){
		preload(callback)
	}
}
