var exec = require('child_process').exec;
var fs = require('graceful-fs');
var path = require('path');
var mkdirp = require('mkdirp');
var rimraf = require('rimraf');
var request = require('request');

var Promise = require('rsvp').Promise;
var asp = require('rsvp').denodeify;

var tar = require('tar');
var zlib = require('zlib');

var DecompressZip = require('decompress-zip');

var semver = require('semver');

var which = require('which');

var ArtifactoryLocation = function(options, ui) {


  this.name = options.name;

  this.max_repo_size = (options.maxRepoSize || 0) * 1024 * 1024;

  this.versionString = options.versionString + '.1';

  this.execOpt = {
    cwd: options.tmpDir,
    timeout: options.timeout * 1000,
    killSignal: 'SIGKILL',
    maxBuffer: 2 * 1024 * 1024
  };
  this.artifactoryHostName = options.remote;
}

function clearDir(dir) {
  return new Promise(function(resolve, reject) {
    fs.exists(dir, function(exists) {
      resolve(exists);
    });
  })
    .then(function(exists) {
      if (exists)
        return asp(rimraf)(dir);
    });
}

function prepDir(dir) {
  return clearDir(dir)
    .then(function() {
      return asp(mkdirp)(dir);
    });
}

// check if the given directory contains one directory only
// so that when we unzip, we should use the inner directory as
// the directory
function checkStripDir(dir) {
  return asp(fs.readdir)(dir)
    .then(function(files) {
      if (files.length > 1)
        return dir;

      var dirPath = path.resolve(dir, files[0]);

      return asp(fs.stat)(dirPath)
        .then(function(stat) {
          if (stat.isDirectory())
            return dirPath;

          return dir;
        });
    });
}

// static configuration function
ArtifactoryLocation.configure = function(config, ui) {
  return Promise.resolve(ui.input('Enter the hostname of your Artifactory server', config.remote))
    .then(function(remote) {
      config.remote = remote;
    });
};

// regular expression to verify package names
ArtifactoryLocation.packageFormat = /^[^\/]+\/[^\/]+/;

ArtifactoryLocation.prototype = {

  // given a repo name, locate it and ensure it exists
  locate: function(repo) {
    var self = this;
    var remoteString = this.remoteString;

    if (repo.split('/').length !== 2)
      throw "GitHub packages must be of the form `owner/repo`.";

    // request the repo to check that it isn't a redirect
    return new Promise(function(resolve, reject) {
      resolve();
    });
  },
  lookup: function(repo) {
    var execOpt = this.execOpt;
    var remoteString = this.artifactoryHostName+'/artifactory/api/vcs';
    return new Promise(function(resolve, reject) {
      // NB cache this on disk with etags
      var reqOptions = {
        uri: remoteString + '/tags/github-remote/' + repo,
        headers: {
          'User-Agent': 'jspm'/*,
           'Accept': 'application/vnd.github.v3+json'*/
        },
        followRedirect: false
      };
      return asp(request)(reqOptions)
        .then(function(res) {
          return Promise.resolve()
            .then(function() {
              try {
                return JSON.parse(res.body);
              }
              catch(e) {
                throw 'Unable to parse Artifactory API response';
              }
            })
            .then(function(releases) {

              versions = {};
              /*            var releases = stdout.split('\n');*/
              for (var i = 0; i < releases.length; i++) {
                if (!releases[i])
                  continue;

                var hash = releases[i].commitId;
                var refName = releases[i].name;
                var version = releases[i].name;;
                var versionObj = { hash: hash, meta: {} };

                if (version.substr(0, 1) == 'v' && semver.valid(version.substr(1))) {
                  version = version.substr(1);
                  // note when we remove a "v" which versions we need to add it back to
                  // to work out the tag version again
                  versionObj.meta.vPrefix = true;
                }
                versions[version] = versionObj;
              }

              resolve({ versions: versions });
            });
        });
    });
  },

  // optional hook, allows for quicker dependency resolution
  // since download doesn't block dependencies
  getPackageConfig: function(repo, version, hash, meta) {
    if (meta.vPrefix)
      version = 'v' + version;


    return asp(request)({
      uri: this.artifactoryHostName+'/artifactory/api/vcs/downloadTagFile/github-remote/'+repo+'/'+version+'!package.json',
      headers: {
        'User-Agent': 'jspm'
      }

    }).then(function(res) {
      if (res.statusCode == 404) {
        console.log(404);
        // it is quite valid for a repo not to have a package.json
        return {};
      }

      if (res.statusCode != 200)
        throw 'Unable to check repo package.json for release, status code ' + res.statusCode;

      var packageJSON;

      try {
        packageJSON = JSON.parse(res.body);
      }
      catch(e) {
        throw 'Error parsing package.json';
      }

      return packageJSON;
    });
  },

  processPackageConfig: function(pjson) {
    if (!pjson.jspm || !pjson.jspm.files)
      delete pjson.files;

    if (!pjson.registry && (!pjson.jspm || !pjson.jspm.dependencies))
      delete pjson.dependencies;

    // on GitHub, single package names ('jquery') are from jspm registry
    // double package names ('components/jquery') are from github registry
    for (var d in pjson.dependencies) {
      var depName = pjson.dependencies[d];
      var depVersion;

      if (depName.indexOf(':') != -1)
        continue;

      if (depName.indexOf('@') != -1) {
        depName = depName.substr(0, depName.indexOf('@'));
        depVersion = depName.substr(depName.indexOf('@') + 1);
      }
      else {
        depVersion = depName;
        depName = d;
      }

      if (depName.split('/').length == 1)
        pjson.dependencies[d] = 'jspm:' + depName + (depVersion && depVersion !== true ? '@' + depVersion : '');
    }
    return pjson;
  },

  download: function(repo, version, hash, meta, outDir) {
    var artifactoryHostName = this.artifactoryHostName;
    if (meta.vPrefix)
      version = 'v' + version;

    var execOpt = this.execOpt;
    var max_repo_size = this.max_repo_size;
    var remoteString = this.remoteString;

    var self = this;

    return this.checkReleases(repo, version)
      .then(function(release) {
        if (!release)
          return true;

        // Download from the release archive
        return new Promise(function(resolve, reject) {
          var inPipe;

          if (release.type == 'tar') {
            inPipe = zlib.createGunzip()
              .pipe(tar.Extract({ path: outDir, strip: 1 }))
              .on('end', function() {
                resolve();
              })
              .on('error', reject);
          }
          else if (release.type == 'zip') {
            var tmpDir = path.resolve(execOpt.cwd, 'release-' + repo.replace('/', '#') + '-' + version);
            var tmpFile = tmpDir + '.' + release.type;

            var repoDir;

            inPipe = fs.createWriteStream(tmpFile)
              .on('finish', function() {
                new Promise(function(resolve, reject) {

                  var unzipper = new DecompressZip(tmpFile);

                  unzipper.on('error', reject);
                  unzipper.on('extract', resolve);

                  unzipper.extract({
                    path: tmpDir
                  });

                })
                  .then(function() {
                    return checkStripDir(tmpDir);
                  })
                  .then(function(_repoDir) {
                    repoDir = _repoDir;
                    return asp(fs.rmdir)(outDir);
                  })
                  .then(function() {
                    return asp(fs.rename)(repoDir, outDir);
                  })
                  .then(function() {
                    return asp(fs.unlink)(tmpFile);
                  })
                  .then(resolve, reject);
              })
              .on('error', reject);
          }
          else {
            throw 'GitHub release found, but no archive present.';
          }

          // now that the inPipe is ready, do the request
          request({
            uri: release.url,
            headers: {
              'accept': 'application/octet-stream',
              'user-agent': 'jspm'
            },
            followRedirect: false,
            auth: self.auth && {
              user: self.auth.username,
              pass: self.auth.password
            }
          }).on('response', function(archiveRes) {
              if (archiveRes.statusCode != 302)
                return reject('Bad response code ' + archiveRes.statusCode + '\n' + JSON.stringify(archiveRes.headers));

              request({
                uri: archiveRes.headers.location,
                headers: {
                  'accept': 'application/octet-stream',
                  'user-agent': 'jspm'
                }
              })
                .on('response', function(archiveRes) {

                  if (max_repo_size && archiveRes.headers['content-length'] > max_repo_size)
                    return reject('Response too large.');

                  archiveRes.pause();

                  archiveRes.pipe(inPipe);

                  archiveRes.on('error', reject);

                  archiveRes.resume();

                })
                .on('error', reject);
            })
            .on('error', reject);
        });
      })
      .then(function(git) {
        if (!git)
          return;
        // Download from the git archive
        return new Promise(function(resolve, reject) {
          request({
            //uri: remoteString + repo + '/archive/' + version + '.tar.gz',
            uri:artifactoryHostName+'/artifactory/api/vcs/downloadTag/github-remote/'+repo+'/'+version,
            headers: { 'accept': 'application/octet-stream' }
          })
            .on('response', function(pkgRes) {
              if (pkgRes.statusCode != 200)
                return reject('Bad response code ' + pkgRes.statusCode);

              if (max_repo_size && pkgRes.headers['content-length'] > max_repo_size)
                return reject('Response too large.');

              pkgRes.pause();

              var gzip = zlib.createGunzip();

              pkgRes
                .pipe(gzip)
                .pipe(tar.Extract({ path: outDir, strip: 1 }))
                .on('error', reject)
                .on('end', resolve);

              pkgRes.resume();

            })
            .on('error', reject);
        });
      });
  },

  checkReleases: function(repo, version) {
    // NB cache this on disk with etags
    var reqOptions = {
      uri: this.artifactoryHostName+'/artifactory/api/vcs/tags/github-remote/' + repo,
      headers: {
        'User-Agent': 'jspm'/*,
         'Accept': 'application/vnd.github.v3+json'*/
      },
      followRedirect: false
    };

    return asp(request)(reqOptions)
      .then(function(res) {
        return Promise.resolve()
          .then(function() {
            try {
              return JSON.parse(res.body);
            }
            catch(e) {
              throw 'Unable to parse GitHub API response';
            }
          })
          .then(function(releases) {
            // run through releases list to see if we have this version tag
            for (var i = 0; i < releases.length; i++) {
              var tagName = (releases[i].name || '').trim();

              if (tagName == version) {
                //var firstAsset = releases[i].assets[0];
                var firstAsset = releases[i];
                if (!firstAsset)
                  return false;

                var assetType;

                if (firstAsset.name.substr(firstAsset.name.length - 7, 7) == '.tar.gz' || firstAsset.name.substr(firstAsset.name.length - 4, 4) == '.tgz')
                  assetType = 'tar';
                else if (firstAsset.name.substr(firstAsset.name.length - 4, 4) == '.zip')
                  assetType = 'zip';
                else
                  return false;

                return { url: firstAsset.url, type: assetType };
              }
            }
            return false;
          });
      });
  },

  // check if the main entry point exists. If not, try the bower.json main.
  build: function(pjson, dir) {
    var main = pjson.main || '';
    var libDir = pjson.directories && (pjson.directories.dist || pjson.directories.lib) || '.';

    if (main instanceof Array)
      main = main[0];

    if (typeof main != 'string')
      return;

    // convert to windows-style paths if necessary
    main = main.replace(/\//g, path.sep);
    libDir = libDir.replace(/\//g, path.sep);

    if (main.indexOf('!') != -1)
      return;

    function checkMain(main, libDir) {
      if (!main)
        return Promise.resolve(false);

      if (main.substr(main.length - 3, 3) == '.js')
        main = main.substr(0, main.length - 3);

      return new Promise(function(resolve, reject) {
        fs.exists(path.resolve(dir, libDir || '.', main) + '.js', function(exists) {
          resolve(exists);
        });
      });
    }

    return checkMain(main, libDir)
      .then(function(hasMain) {
        if (hasMain)
          return;

        return asp(fs.readFile)(path.resolve(dir, 'bower.json'))
          .then(function(bowerJson) {
            try {
              bowerJson = JSON.parse(bowerJson);
            }
            catch(e) {
              return;
            }

            main = bowerJson.main || '';
            if (main instanceof Array)
              main = main[0];

            return checkMain(main);
          }, function() {})
          .then(function(hasBowerMain) {
            if (!hasBowerMain)
              return;

            pjson.main = main;
          });
      });
  }

};

module.exports = ArtifactoryLocation;
