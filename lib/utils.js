var utils = module.exports = {}

utils.fieldsSize = function(types){
  var size = 0
  for(var type of types){
    switch(type){
      case 'postcode':
        size += 5
        break
      case 'area':
        size += 2
        break
      default:
        size += 4
        break
      }
  }
  return size
}

utils.aton4 = function(a) {
  a = a.split(/\./)
  return ((parseInt(a[0], 10)<<24)>>>0) + ((parseInt(a[1], 10)<<16)>>>0) + ((parseInt(a[2], 10)<<8)>>>0) + (parseInt(a[3], 10)>>>0)
}

utils.aton6 = function(a) {
  a = a.replace(/"/g, '').split(/:/)

  var l = a.length - 1
  var i

  if (a[l] === '') a[l] = 0

  if (l < 7) {
    var omitted = 8 - a.length, omitStart = a.indexOf(''), omitEnd = omitStart + omitted
    for(i = 7; i >= omitStart; i--){
      a[i] = i > omitEnd ? a[i - omitted] : 0
    }
  }

  var r = 0n
  for (i = 0; i < 4; i++) {
    if(a[i]) {
      r += BigInt(parseInt(a[i], 16)) << BigInt(16 * (3 - i))
    }
  }
  return r
}
utils.isPrivateIP = function(addr) {
  addr = addr.toString()
  return addr.match(/^10\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})/) != null ||
    addr.match(/^192\.168\.([0-9]{1,3})\.([0-9]{1,3})/) != null ||
    addr.match(/^172\.16\.([0-9]{1,3})\.([0-9]{1,3})/) != null ||
    addr.match(/^127\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})/) != null ||
    addr.match(/^169\.254\.([0-9]{1,3})\.([0-9]{1,3})/) != null ||
    addr.match(/^fc00:/) != null || addr.match(/^fe80:/) != null
}

utils.ntoa4 = function(n) {
  n = n.toString()
  n = '' + (n>>>24&0xff) + '.' + (n>>>16&0xff) + '.' + (n>>>8&0xff) + '.' + (n&0xff)
  return n
}
