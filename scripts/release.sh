# get current version from package.json
RES1=`find . -name '*.dat' -size -1000k 2>/dev/null`
if [ -z "$RES1" ]; then
	if ! git diff --quiet HEAD -- *.dat; then
		VERT=`node -p "var j=require('./package.json');j.version=j.version.split('.').slice(0,-1).join('.')+'.'+require('dayjs')().format('YYYYMMDDHHmm');require('fs').writeFileSync('./package.json',JSON.stringify(j,null,2));j.version;"`
		git config --local user.email "41898282+github-actions[bot]@users.noreply.github.com"
		git config --local user.name "github-actions[bot]"
		git commit -a -m "v${VERT} auto update ip database"
		npm publish --provenance --access public
	fi
fi
