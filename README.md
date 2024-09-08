> [!CAUTION]
> This repository would not maintaine any more.
> We recommend to use new library [ip-location-api](https://github.com/sapics/ip-location-api) which has faster and customizable system, we created from scratch.

# geoip-country [![NPM version](https://badge.fury.io/js/geoip-country.svg)](https://badge.fury.io/js/geoip-country)

A native nodejs API to get country information from ip address.

This library is fork of the [geoip-lite](https://github.com/bluesmoon/node-geoip) which provides a very fast ip to geolocation API by loading the ip to geolocation database into memory.
However, because the database contains city and coordinate information, etc., its size exceeds 120 MB, which means that it uses a lot of memory and takes a long time before the first execution.

`geoip-country` reduces memory usage and faster startup and faster lookup by restricting database to country from geolocation.
Futhermore, we add the other information `capital`, `continent_name`, `languages`, etc., from v5.
You can check the `test/benchmark.js` after updating `geoip-lite` database.
The following tests were performed on Node.js v20 on a PC using SSD.

| benchmark | database size | startup time | lookup time |
| ---- | ---- | ---- |  ---- | 
| geoip-country | 7 MB  | 17 ms | 0.95 μs/ip |
| geoip-lite    | 124MB | 52 ms | 2.37 μs/ip |


This product includes GeoLite2 ipv4 and ipv6 country data created by [MaxMind](http://maxmind.com/).
The database of this product **updates twice a weekly**.

**You should read this README and the LICENSE and EULA files carefully before deciding to use this product.**<br>
**After v4, LICENSE for the GeoLite2 database was changed. If you need to use this product with previous LICENSE, please use v3.**


## Synopsis

```javascript
var geoip = require('geoip-country');

var ip = "207.97.227.239";
var geo = geoip.lookup(ip);

console.log(geo);
{
  country: 'US', // "2 letter" country code defined at ISO-3166-1 alpha-2
  name: 'United States',
  native: 'United States',
  continent: 'NA',
  continent_name: 'North America',
  phone: [ 1 ],
  capital: 'Washington D.C.',
  currency: [ 'USD', 'USN', 'USS' ],
  languages: [ 'en' ],
}
```


## Installation

```bash
$ npm i geoip-country
```


## API

geoip-country is completely synchronous. There are no callbacks involved. All blocking file IO is done at startup time, so all runtime
calls are executed in-memory and are fast. Startup may take up to 20ms while it reads into memory and indexes data files.


### Looking up an IP address ###

If you have an IP address in dotted quad notation, IPv6 colon notation, or a 32 bit unsigned integer (treated
as an IPv4 address), pass it to the `lookup` method.

```javascript
var geo = geoip.lookup(ip);
```

If the IP address was found, the `lookup` method returns an object with the following structure:

```javascript
{
  country: 'CN', // "2 letter" country code defined at ISO-3166-1 alpha-2
  name: 'China',
  native: '中国',
  continent: 'AS',
  continent_name: 'Asia',
  phone: [ 86 ],
  capital: 'Beijing',
  currency: [ 'CNY' ],
  languages: [ 'zh' ],
}
```

If the IP address was not found, the `lookup` returns `null`.

We use two databases for getting `ip address` to `geo` data.
First is `GeoLite2 country` database for linking `ip address` to `country` which is "2 letter" country code which is defined at ISO-3166-1 alpha-2 [wiki](https://en.wikipedia.org/wiki/ISO_3166-1).
Second database is [Countries](https://github.com/annexare/Countries) database which is published under MIT License for linking `country` to `languages`, `capital`, `continent`, etc.


## Built-in Updater

This package contains an update script that can pull the files from MaxMind and handle the conversion from CSV.
A npm script alias has been setup to make this process easy. Please keep in mind this requires internet and MaxMind
rate limits that amount of downloads on their servers.

```bash
npm run updatedb --license_key=YOUR_GEOLITE2_LICENSE_KEY
	or
GEOLITE2_LICENSE_KEY=YOUR_GEOLITE2_LICENSE_KEY node scripts/updatedb.js
```

_YOUR_GEOLITE2_LICENSE_KEY should be replaced by a valid GeoLite2 license key. Please [follow instructions](https://dev.maxmind.com/geoip/geoip2/geolite2/) provided by MaxMind to obtain a license key._


### Update database API [Added at v4.1.0]

You can update country database with `updateDatabase` method.

```javascript
  geoip.updateDatabase(license_key, callback);
```

`license_key` is a license key which provided by MaxMind.
You can get GeoLite2 license key as [instructions](https://dev.maxmind.com/geoip/geoip2/geolite2/).

By setting the environmental variable `GEOLITE2_LICENSE_KEY`, you can update with

```javascript
  geoip.updateDatabase(callback);
```

## Fast lookup setting

By setting CLI parameter `--geoip_fast_lookup=XX` or envirnment `GEOIP_FAST_LOOKUP=XX`, you can make faster lookup time, in exchange for slower startup time and increase memory usage.
Default of `geoip_fast_lookup` is 12, 4 is minimum and 18 is maximum.

| geoip_fast_lookup | increased memory usage | startup time | lookup time |
| ---- | ---- | ---- |  ---- | 
| 4 [min]        | 192 B  | 13 ms | 1.15 μs/ip |
| 6              | 768 B  | 13 ms | 1.11 μs/ip |
| 8              | 3 KB   | 13 ms | 1.07 μs/ip |
| 10             | 12 KB  | 15 ms | 1.00 μs/ip |
| 12 [default]   | 48 KB  | 17 ms | 0.95 μs/ip |
| 14             | 192 KB | 19 ms | 0.91 μs/ip |
| 16             | 768 KB | 22 ms | 0.87 μs/ip |
| 18 [max]       | 3 MB   | 31 ms | 0.84 μs/ip |
| 20 [cannot use]| 12 MB  | 59 ms | 0.87 μs/ip |


## Use ip-location-db database

You can use [ip-location-db](https://github.com/sapics/ip-location-db) database with the environment variable `IP_LOCATION_DB` or CLI parameter `--ip_location_db=XXXXX`. For example, if you want to use `geolite2-geo-whois-asn-country` which supports wider ip than `geolite2-country`, you can update the database by executing `npm run updatedb --ip_location_db=geolite2-geo-whois-asn`.

If you cannot use GeoLite2 licence for your use-case, the licence issue can be circumvented by replacing the database in [ip-location-db](https://github.com/sapics/ip-location-db), as there are also some Public licenced ([CC0](https://creativecommons.org/publicdomain/zero/1.0/deed) [PDDL](https://opendatacommons.org/licenses/pddl/1.0/)) databases in [ip-location-db](https://github.com/sapics/ip-location-db).


## Custom Directory for database files

You can store the database files in custom directory with the environment variable `GEOIP_DATADIR` or CLI parameter `--geoip_datadir=XXXXX`.
For creating or updating the database files in custom directory, you need to run built-in updater as documented above with setting the environment variable `GEOIP_DATADIR` or CLI parameter `--geoip_datadir=XXXXX`.
If you have no write-access to the `geoip-country` directory, it would be better to set the environment `GEOIP_TMPDATADIR` or CLI parameter `--geoip_tmpdatadir=YYYYY` for temporary directory when updating the database files.


## License and EULA

Please carefully read the LICENSE and EULA files. This package comes with certain restrictions and obligations, most notably:
 - You cannot prevent the library from updating the databases.
 - You cannot use the GeoLite2 data:
   - for FCRA purposes,
   - to identify specific households or individuals.

You can read [the latest version of GeoLite2 EULA](https://www.maxmind.com/en/geolite2/eula).
GeoLite2 database is provided under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) by [MaxMind](https://www.maxmind.com/), so, you must create attribusion to [MaxMind](https://www.maxmind.com/) for using GeoLite2 database.


The license for the software itself is an Apache License 2.0 by [geoip-country](https://github.com/sapics/geoip-country).
This software is created from the repository [geoip-lite/node-geoip](https://github.com/geoip-lite/node-geoip).
The software license of [geoip-lite/node-geoip](https://github.com/geoip-lite/node-geoip) is Apache License 2.0.


## References
  - <a href="https://www.maxmind.com/en/geolite2/eula">GeoLite2 EULA</a>
  - <a href="https://www.maxmind.com/app/iso3166">Documentation from MaxMind</a>
  - <a href="https://en.wikipedia.org/wiki/ISO_3166">ISO 3166 (1 & 2) codes</a>
  - <a href="https://en.wikipedia.org/wiki/List_of_FIPS_region_codes">FIPS region codes</a>
  - <a href="https://github.com/annexare/Countries">annexare/Countries</a>
