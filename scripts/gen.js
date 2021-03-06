var async       = require('async');
var fs          = require('fs');
var geocode     = require('google-geocode');
var readline    = require('readline');
var util        = require('util');
var WikiScraper = require('wikiscraper');

geocode.setApiKey(process.env.GOOGLE_DEVELOPER_API_KEY);

// Usage: node scripts/gen.js sports/basketball/usa/dream_team.txt sports/basketball/usa/dream_team.geojson
var inFile  = process.argv[2];
var outFile = process.argv[3];

var exclusions = [];

function initFeatureCollection() {
  return {
    type: 'FeatureCollection',
    features: []
  };
}

function initFeature(name) {
  return {
    type: 'Feature',
    properties: {
      name: name,
      born: ''
    },
    geometry: {
      type: 'Point'
    }
  };
}

function sanitise(born) {

  if (born.indexOf('present-day') >= 0) {
    var city = born.substring(0, born.indexOf(','));
    var country = born.substring(born.indexOf('present-day') + 'present-day'.length + 1, born.indexOf(')'));
    born = util.format('%s, %s', city, country);
  }

  if (born.indexOf('modern') >= 0) {
    var city = born.substring(0, born.indexOf(','));
    var country = born.substring(born.indexOf('modern') + 'modern'.length + 1, born.indexOf(')'));
    born = util.format('%s, %s', city, country);
  }

  if (born.indexOf('then part of') >= 0) {
    born = born.substring(0, born.indexOf(', then part of'));
  }

  if (born.indexOf('German Empire') >= 0) {
    born = born.replace('German Empire', 'German');
  }

  if (born.indexOf('Russian Empire') >= 0) {
    born = born.replace('Russian Empire', 'Russia');
  }

  return born;
}

function getFeature(name, cb) {
  var wikiscraper = new WikiScraper([name]);

  console.log('Scraping Wikipedia page of %s', name);
  wikiscraper.scrape(function(err, element) {
    if (err) {
      cb(err);
    }
    else {

      if (process.env.DEBUG === 'true') {
        console.dir(element.infobox);
      }

      if (name.indexOf(' (') >= 0) {
        name = name.substring(0, name.indexOf(' ('));
      }

      if (element.infobox.fields.Born) {
        var born_elems = element.infobox.fields.Born.split('\n');
        var born = born_elems[born_elems.length - 1];
        if (born.indexOf('[') >= 0) {
          born = born.substring(0, born.indexOf('['));
        }

        var feature = initFeature(name);
        feature.properties.born = born;

        born = sanitise(born);

        console.log('Geocoding %s birthplace in %s', name, born);
        geocode.getGeocode(encodeURIComponent(born),
          function (geocode) {
            geocode = JSON.parse(geocode);

            if (process.env.DEBUG === 'true') {
              console.dir(geocode);
              console.dir(geocode.status);
            }

            if (geocode.status === 'ZERO_RESULTS') {
              var message = geocode.status;
              exclusions.push(util.format('%s - %s', name, message));
              console.error(message);
              cb(null, null);
            } else {
              var location = geocode.results[0].geometry.location;
              feature.geometry.coordinates = [location.lng, location.lat];
              cb(null, feature);
            }

          },
          function (err) {
            cb(err)
          });
      } else {
        var message = 'Wikipedia page does not have infoxbox born field';
        exclusions.push(util.format('%s - %s', name, message));
        console.error(message);
        cb(null, null);
      }
    }
  });

}
function getFeatures(names, cb) {
  var tasks = [];
  names.forEach(function (name) {
    var task = function (cb) {
      getFeature(name, cb);
    };
    tasks.push(task);
  });
  async.parallelLimit(tasks, 25, cb);
}

var names = [];

console.log('Reading input file %s', inFile);
var rl = readline.createInterface({
  input: fs.createReadStream(inFile)
});
rl.on('line', function (name) {
  names.push(name);
});
rl.on('close', function () {
  var data = initFeatureCollection();
  getFeatures(names, function (err, _features) {
    var features = [];
    _features.forEach(function (_feature) {
      if (_feature !== null) {
        features.push(_feature);
      }
    });
    if (err) {
      console.error(err);
    } else {
      data.features = features;
      console.log('Writing output file %s', outFile);
      if (exclusions.length > 0) {
        console.log('Some names are excluded from the map:');
        exclusions.forEach(function (exclusion) {
          console.log(exclusion);
        });
      } else {
        console.log('All names are included in the map');
      }
      fs.writeFileSync(outFile, JSON.stringify(data, null, 2));
    }
  });
});
