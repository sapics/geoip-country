# geoip-country [![NPM version](https://badge.fury.io/js/geoip-country.svg)](https://badge.fury.io/js/geoip-country)

!!! **The difference with original version is removed redundant "colors" package** !!!

Less memory usage version of [geoip-lite](https://github.com/bluesmoon/node-geoip) by limiting to country information.
This product includes GeoLite2 ipv4 and ipv6 country data which created by MaxMind, available from https://www.maxmind.com.
The database of this product **updates weekly**.

**You should read this README and the LICENSE and EULA files carefully before deciding to use this product.**<br>
**After v4, LICENSE for the database was changed. If you need to use this product with previous LICENSE, please use v3.**


## Synopsis

```javascript
var geoip = require('geoip-country');

var ip = "207.97.227.239";
var geo = geoip.lookup(ip);

console.log(geo);
{ range: [ 3479299040, 3479299071 ],
  country: 'US'}
```


## Installation

### 1. Install the library

    $ npm install geoip-country

### 2. Update MaxMind's geoip data

    $ npm run-script updatedb --license_key=YOUR_GEOLITE2_LICENSE_KEY
		or
    $ GEOLITE2_LICENSE_KEY=YOUR_GEOLITE2_LICENSE_KEY node scripts/updatedb.js

_YOUR_GEOLITE2_LICENSE_KEY should be replaced by a valid GeoLite2 license key. Please [follow instructions](https://dev.maxmind.com/geoip/geoip2/geolite2/) provided by MaxMind to obtain a license key._


## API

geoip-country is completely synchronous.  There are no callbacks involved.  All blocking file IO is done at startup time, so all runtime
calls are executed in-memory and are fast.  Startup may take up to 20ms while it reads into memory and indexes data files.

### Looking up an IP address ###

If you have an IP address in dotted quad notation, IPv6 colon notation, or a 32 bit unsigned integer (treated
as an IPv4 address), pass it to the `lookup` method.  Note that you should remove any `[` and `]` around an
IPv6 address before passing it to this method.

```javascript
var geo = geoip.lookup(ip);
```

If the IP address was found, the `lookup` method returns an object with the following structure:

```javascript
{
   range: [ <low bound of IP block>, <high bound of IP block> ],
   country: 'XX' // 2 letter ISO-3166-1 country code
}
```

The actual values for the `range` array depend on whether the IP is IPv4 or IPv6 and should be
considered internal to `geoip-country`.  To get a human readable format, pass them to `geoip.pretty()`

If the IP address was not found, the `lookup` returns `null`

### Update database API [Added at v4.1.0]

You can update country database with `updateDatabase` method.

```javascript
    geoip.updateDatabase(license_key, callback);
```

`license_key` is a license key which provided by MaxMind. You can get GeoLite2 license key as [instructions](https://dev.maxmind.com/geoip/geoip2/geolite2/).

### Pretty printing an IP address ###

If you have a 32 bit unsigned integer, or a number returned as part of the `range` array from the `lookup` method,
the `pretty` method can be used to turn it into a human readable string.

```javascript
    console.log("The IP is %s", geoip.pretty(ip));
```

This method returns a string if the input was in a format that `geoip-country` can recognize, else it returns the
input itself.


## Built-in Updater

This package contains an update script that can pull the files from MaxMind and handle the conversion from CSV.
A npm script alias has been setup to make this process easy. Please keep in mind this requires internet and MaxMind
rate limits that amount of downloads on their servers.

```shell
npm run-script updatedb --license_key=YOUR_GEOLITE2_LICENSE_KEY
	or
GEOLITE2_LICENSE_KEY=YOUR_GEOLITE2_LICENSE_KEY node scripts/updatedb.js
```

_YOUR_GEOLITE2_LICENSE_KEY should be replaced by a valid GeoLite2 license key. Please [follow instructions](https://dev.maxmind.com/geoip/geoip2/geolite2/) provided by MaxMind to obtain a license key._


## Custom Directory for database files

You can store the database files in custom directory with the environment variable `GEODATADIR` or CLI parameter `--geodatadir=XXXXX`.
For creating or updating the database files in custom directory, you need to run built-in updater as documented above with setting the environment variable `GEODATADIR` or CLI parameter `--geodatadir=XXXXX`.
If you have no write-access to the `geoip-country` directory, it would be better to set the environment `GEOTMPDATADIR` or CLI parameter `--geotmpdatadir=YYYYY` for temporary directory when updating the database files.


## License and EULA

Please carefully read the LICENSE and EULA files. This package comes with certain restrictions and obligations, most notably:
 - You cannot prevent the library from updating the databases.
 - You cannot use the GeoLite2 data:
   - for FCRA purposes,
   - to identify specific households or individuals.

You can read [the latest version of GeoLite2 EULA](https://www.maxmind.com/en/geolite2/eula).


## References
  - <a href="https://www.maxmind.com/en/geolite2/eula">GeoLite2 EULA</a>
  - <a href="https://www.maxmind.com/app/iso3166">Documentation from MaxMind</a>
  - <a href="https://en.wikipedia.org/wiki/ISO_3166">ISO 3166 (1 & 2) codes</a>
  - <a href="https://en.wikipedia.org/wiki/List_of_FIPS_region_codes">FIPS region codes</a>
