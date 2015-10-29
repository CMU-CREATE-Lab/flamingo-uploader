var fs = require('fs');
var os = require('os');
var path = require('path');
var crypto = require('crypto');
var constants = require('constants');

var TEMP_DIR = os.tmpdir();
var RANDOM_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
var CREATE_FLAGS = constants.O_CREAT | constants.O_EXCL | constants.O_RDWR;
var FILE_MODE = 384; // 0600
var TOTAL_TRIES = 10;

var counter = 0;

/**
 * Random name generator based on crypto.
 * Stolen from https://github.com/raszi/node-tmp
 *
 * @param {Number} howMany
 * @return {String}
 * @api private
 */
function generateRandomCharacters(howMany) {
   var value = [];
   var rnd = null;

   // make sure that we do not fail because we ran out of entropy
   try {
      rnd = crypto.randomBytes(howMany);
   }
   catch (e) {
      rnd = crypto.pseudoRandomBytes(howMany);
   }

   for (var i = 0; i < howMany; i++) {
      value.push(RANDOM_CHARS[rnd[i] % RANDOM_CHARS.length]);
   }

   return value.join('');
}

var generateTempFilename = function(options) {
   options = options || {};

   var hrTime = process.hrtime();

   // prefix and postfix
   var name = [
      options.prefix || 'tmp',
      process.pid,
      hrTime[0],
      hrTime[1],
      counter++,
      generateRandomCharacters(12)
   ].join('_');

   name += options.suffix || '.tmp';

   return path.join(TEMP_DIR, name);
};

/**
 * A simple class for creating temporary files.  I stole a lot from node-tmp (https://github.com/raszi/node-tmp), but
 * kept only the bare minimum that I needed and changed some stuff I didn't like.
 *
 * @param fileDescriptor the file descriptor
 * @param filePath the absolute path to the file
 * @constructor
 */
function TempFile(fileDescriptor, filePath) {
   this.fd = fileDescriptor;
   this.path = filePath;
}

/**
 * Unlinks the file, possibly throwing an exception upon failure.  WARNING: assumes you have already closed the file!
 */
TempFile.prototype.cleanup = function() {
   fs.unlinkSync(this.path);
};

TempFile.create = function(options, callback) {
   var numTries = 0;
   var fd = null;
   var path = null;

   do {
      path = generateTempFilename(options);
      try {
         fd = fs.openSync(path, CREATE_FLAGS, FILE_MODE);
      }
      catch (e) {
         console.log("Failed to create temp file: " + e);
         fd = null;
      }
      numTries++;
   }
   while (fd == null && numTries < TOTAL_TRIES);

   if (fd == null) {
      callback(new Error("Failed to create a temp file"));
   }
   else {
      callback(null, new TempFile(fd, path));
   }
};

module.exports = TempFile;