var readline = require('readline');
var nimble = require('nimble');
var superagent = require('superagent');
var httpStatus = require('http-status');
var fs = require('fs');
var path = require('path');
var TempFile = require('./lib/TempFile');
var os = require('os');
var config = require('./config');

var ESDR_ROOT_URL = config.get("esdr:rootUrl");
var ESDR_API_ROOT_URL = config.get("esdr:apiRootUrl");
var FLAMINGO_PRODUCT_NAME = "flamingo_v1";
var NUM_FIELDS_PER_LINE = 9;

// Flamingo data file fields
// 0: Node name
// 1: Node number
// 2: Timestamp
// 3: Serial number
// 4: Temperature
// 5: Conductivity
// 6: Error indicator
// 7: Voltage
// 8: Checksum

var cli = readline.createInterface(process.stdin, process.stdout);
cli.setPrompt('> ');

var printMessage = function(message) {
   console.log();
   console.log(message);
};

var abort = function(message) {
   printMessage(message);
   process.exit(1);
};

/**
 * Returns <code>true</code> if the given value is a string; returns <code>false</code> otherwise.
 *
 * Got this from http://stackoverflow.com/a/9436948/703200
 */
var isString = function(o) {
   return (typeof o == 'string' || o instanceof String)
};

/**
 * Trims the given string.  If not a string, returns an empty string.
 *
 * @param {string} str the string to be trimmed
 */
var trim = function(str) {
   if (isString(str)) {
      return str.trim();
   }
   return '';
};

var isStringNonEmpty = function(str) {
   return isString(str) && str.length > 0;
};

// keep trying to authenticate with ESDR until successful
var authenticateWithEsdr = function(callback) {
   printMessage("Please log in to ESDR:");

   var defaultUsername = config.get("defaultUser:username");
   var defaultPassword = config.get("defaultUser:password");

   var hasDefaultUsername = isStringNonEmpty(defaultUsername);
   var hasDefaultPassword = isStringNonEmpty(defaultPassword);

   cli.question("   Username" + (hasDefaultUsername ? " [" + defaultUsername + "]" : "") + ": ", function(username) {
      cli.question("   Password" + (hasDefaultPassword ? " [" + defaultPassword + "]" : "") + ": ", function(password) {

         // use the defaults if the user didn't enter anything
         if (hasDefaultUsername && !isStringNonEmpty(username)) {
            username = defaultUsername;
         }
         if (hasDefaultPassword && !isStringNonEmpty(password)) {
            password = defaultPassword;
         }

         if (username && password && username.length > 0 && password.length > 0) {
            var abort = function(err) {
               abort("Authentication failed due to an unexpected error: " + err);
            };
            superagent
                  .post(ESDR_ROOT_URL + "/oauth/token")
                  .send({
                     grant_type : "password",
                     client_id : config.get("client:name"),
                     client_secret : config.get("client:secret"),
                     username : username,
                     password : password
                  })
                  .end(function(err, res) {
                          if (err) {
                             if (err.status) {
                                switch (err.status) {
                                   case httpStatus.UNAUTHORIZED:
                                   case httpStatus.FORBIDDEN:
                                      printMessage("Authentication failed, please try again...");
                                      authenticateWithEsdr(callback);
                                      break;
                                   default:
                                      abort(err);
                                }
                             }
                             else {
                                abort(err);
                             }
                          }
                          else {
                             printMessage("Successfully logged in to ESDR.");
                             callback(res.body);
                          }
                       });
         }
         else {
            printMessage("Username and password cannot be empty, please try again...");
            authenticateWithEsdr(callback);
         }
      });
   });
};

// prompt user for the path to the data file (keep doing so until we get a valid one)
var getDataFileInputStream = function(callback) {
   console.log();
   cli.question('Enter the path to your Flamingo CSV data file: ', function(thePath) {
      thePath = path.resolve(trim(thePath));
      if (thePath && thePath.length > 0) {
         // create a readstream to verify that the file is readable.  TODO: There's probably a better way to do this.
         var stream = fs.createReadStream(thePath, { flags : 'r' });
         stream.on('error', function(error) {
            printMessage("Invalid path [" + thePath + "]: " + error);
            getDataFileInputStream(callback);
         });
         stream.on('readable', function() {
            callback(thePath);
         });
      }
      else {
         printMessage("The path cannot be empty.");
         getDataFileInputStream(callback);
      }
   });
};

var readFirstLine = function(file, callback) {
   var firstLine = null;
   // create a stream reader for the CSV. Got this from http://stackoverflow.com/a/32599033/703200
   var rl = require('readline').createInterface({
      input : fs.createReadStream(file)
   });

   // save the first line, and ignore all the rest.  Yeah, I know this is inefficient and dumb.
   rl.on('line', function(line) {
      if (firstLine == null) {
         firstLine = line;
      }
   });
   rl.on('close', function() {
      if (firstLine == null) {
         callback(new Error("Failed to read first line of the file"));
      } else {
         callback(null, firstLine);
      }
   });
};

var getOAuth2AuthorizationHeader = function() {
   return {
      Authorization : "Bearer " + oauthAccessToken
   };
};

var getFeedDetails = function(callback) {
   var feed = {
      name : "",
      exposure : "outdoor",   // Flamingos are always outdoor devices
      isPublic : true,        // default to public
      isMobile : false,       // Flamingos are never mobile
      latitude : null,
      longitude : null
   };

   nimble.series(
         [
            // get the feed name
            function(done) {
               var ask = function() {
                  cli.question("   Feed name: ", function(val) {
                     val = trim(val);
                     if (val != null && val.length >= 1 && val.length <= 255) {
                        feed.name = val;
                        done();
                     }
                     else {
                        printMessage("Invalid feed name.  The name cannot be empty. Try again.");
                        ask();
                     }
                  });
               };

               ask();
            },

            // get whether the feed is public
            function(done) {
               cli.question("   Is Public (Y/n): ", function(isPublic) {
                  isPublic = trim(isPublic).toLowerCase();
                  feed.isPublic = !!(isPublic == '' || isPublic == 'y' || isPublic == 'yes' || isPublic == 'true' || isPublic == 1);
                  done();
               });
            },

            // get the latitude
            function(done) {
               var ask = function() {
                  cli.question("   Latitude: ", function(val) {
                     val = trim(val);
                     if (val != null && val >= -90 && val <= 90) {
                        feed.latitude = parseFloat(val);
                        done();
                     }
                     else {
                        printMessage("Invalid latitude. Latitude must be within the range [-90, 90]. Try again.");
                        ask();
                     }
                  });
               };

               ask();
            },

            // get the longitude
            function(done) {
               var ask = function() {
                  cli.question("   Longitude: ", function(val) {
                     val = trim(val);
                     if (val != null && val >= -180 && val <= 180) {
                        feed.longitude = parseFloat(val);
                        done();
                     }
                     else {
                        printMessage("Invalid longitude. Longitude must be within the range [-180, 180]. Try again.");
                        ask();
                     }
                  });
               };

               ask();
            }
         ],

         function() {
            callback(feed);
         }
   );
};

var createFeed = function(callback) {
   var ask = function() {
      getFeedDetails(function(feed) {
         printMessage("The feed will be created with the following attributes:");
         console.log("   Name:      " + feed.name);
         console.log("   Public?:   " + feed.isPublic);
         console.log("   Latitude:  " + feed.latitude);
         console.log("   Longitude: " + feed.longitude);
         cli.question("Proceed? (Y/n): ", function(willCreateFeed) {
            willCreateFeed = trim(willCreateFeed).toLowerCase();
            willCreateFeed = !!(willCreateFeed == '' || willCreateFeed == 'y' || willCreateFeed == 'yes' || willCreateFeed == 'true' || willCreateFeed == 1);
            if (willCreateFeed) {
               superagent
                     .post(ESDR_API_ROOT_URL + "/devices/" + deviceId + "/feeds")
                     .set(getOAuth2AuthorizationHeader())
                     .send(feed)
                     .end(function(err, res) {
                             if (err) {
                                abort("Failed to create feed: " + err);
                             }
                             else {
                                printMessage("Successfully created the feed!");
                                callback(res.body.data);
                             }
                          });
            }
            else {
               printMessage("Create feed aborted.  Please enter the details for the feed to be created...");
               ask();
            }
         });
      });
   };

   ask();
};

var getDecimalNumberParts = function(num, expectedLengthOfMantissa) {
   num = String(num);   // make sure it's a string
   var parts = { characteristic : 0, mantissa : 0 };

   if (num.indexOf('.') >= 0) {
      parts.characteristic = parseInt(num.substring(0, num.indexOf('.')));
      var mantissa = num.substring(num.indexOf('.') + 1);
      if (mantissa.length < expectedLengthOfMantissa) {
         for (var i = mantissa.length; i < expectedLengthOfMantissa; i++) {
            mantissa += "0";
         }
      }
      parts.mantissa = parseInt(mantissa);
   }
   else {
      parts.characteristic = parseInt(num);
   }

   return parts;
};

var computeCrc = function(temperature, conductivity, voltage, errorCodes) {
   // the characteristic and mantissa are summed separately
   var tempParts = getDecimalNumberParts(temperature, 1);   // at most 1 mantissa digits for temperature
   var voltageParts = getDecimalNumberParts(voltage, 2);    // at most 2 mantissa digits for voltage

   // sum up all the parts, and then stuff it into unsigned 8 bits, then return
   var crc = new Uint8Array(1);
   crc[0] = tempParts.characteristic +
            tempParts.mantissa +
            parseInt(conductivity) +
            parseInt(errorCodes) +
            voltageParts.characteristic +
            voltageParts.mantissa;
   return crc[0];
};

var productId = null;
var oauthAccessToken = null;
var filePath = null;
var serialNumber = null;
var needToRegisterDevice = false;
var deviceId = null;
var existingFeeds = null;
var feedToReceiveUpload = null;
var tempFile = null;
nimble.series([
         // Get the Flamingo product ID from ESDR
         function(done) {
            superagent
                  .get(ESDR_API_ROOT_URL + "/products/" + FLAMINGO_PRODUCT_NAME + "?fields=id")
                  .end(function(err, res) {
                          if (err) {
                             abort("Failed to read the Flamingo product ID from ESDR.  Aborting due to error: " + err);
                          }
                          else {
                             if (res.body && res.body.data && typeof res.body.data.id !== 'undefined') {
                                productId = res.body.data.id;
                                done();
                             }
                             else {
                                abort("Failed to read the Flamingo product ID from ESDR. ID not found. Aborting.");
                             }
                          }
                       });
         },

         // Welcome
         function(done) {
            console.log("Welcome to the Flamingo Uploader!");
            done();
         },

         // log in to ESDR
         function(done) {
            authenticateWithEsdr(function(oauth) {
               oauthAccessToken = oauth.access_token;
               done();
            });
         },

         // enter path to data file
         function(done) {
            getDataFileInputStream(function(thePath) {
               filePath = thePath;
               done();
            });
         },

         // read the first line of the data file, to get the serial number
         function(done) {
            readFirstLine(filePath, function(err, line) {
               if (err) {
                  abort("Failed to read the first line.  Aborting due to error: " + err);
               }
               else {
                  var parts = line.split(',');
                  var theSerialNumber = (parts.length >= NUM_FIELDS_PER_LINE) ? trim(parts[3]) : null;
                  if (theSerialNumber) {
                     serialNumber = theSerialNumber;
                     printMessage("This data file is for device with serial number " + serialNumber);
                     done();
                  }
                  else {
                     abort("Failed to read the serial number.  Aborting.");
                  }
               }
            });
         },

         // see if this device is already registered
         function(done) {
            superagent
                  .get(ESDR_API_ROOT_URL + "/devices?where=serialNumber=" + serialNumber)
                  .set(getOAuth2AuthorizationHeader())
                  .end(function(err, res) {
                          if (err) {
                             abort("Failed to read the devices from ESDR.  Aborting due to error: " + err);
                          }
                          else {
                             if (res.body && res.body.data && typeof res.body.data.totalCount !== 'undefined') {
                                needToRegisterDevice = res.body.data.totalCount < 1;

                                // remember the device ID
                                if (!needToRegisterDevice) {
                                   deviceId = res.body.data.rows[0].id;
                                }
                                done();
                             }
                             else {
                                abort("Failed to read the devices from ESDR. Empty response. Aborting.");
                             }
                          }
                       });
         },

         // register the device, if necessary
         function(done) {
            if (needToRegisterDevice) {
               printMessage("This device has not yet been registered under your ESDR account, so we'll do so now...");

               superagent
                     .post(ESDR_API_ROOT_URL + "/products/" + productId + "/devices")
                     .set(getOAuth2AuthorizationHeader())
                     .send({
                        name : "Flamingo (" + serialNumber.substr(0, 8) + ")",
                        serialNumber : serialNumber
                     })
                     .end(function(err, res) {
                             if (err) {
                                abort("Failed to create device in ESDR: " + err);
                             }
                             else {
                                printMessage("Device created!");

                                // remember the device ID
                                deviceId = res.body.data.id;

                                done();
                             }
                          });
            }
            else {
               printMessage("This device has already been registered under your ESDR account.");
               done();
            }
         },

         // See if there are any feeds associated with this device (yeah, yeah...I know I could be a little more
         // efficient by not checking for feeds if we just created the device, but...whatever).  And, yes, this is
         // only going to return at most 1000 feeds, but it's probably safe to assume the user doesn't have more than
         // that for this one device.
         function(done) {
            superagent
                  .get(ESDR_API_ROOT_URL + "/feeds?where=deviceId=" + deviceId)
                  .set(getOAuth2AuthorizationHeader())
                  .end(function(err, res) {
                          if (err) {
                             abort("Failed to read the feeds from ESDR for device [" + deviceId + "].  Aborting due to error: " + err);
                          }
                          else {
                             if (res.body && res.body.data && typeof res.body.data.rows !== 'undefined') {

                                existingFeeds = res.body.data.rows;

                                done();
                             }
                             else {
                                abort("Failed to read the feeds from ESDR for device [" + deviceId + "]. Empty response. Aborting.");
                             }
                          }
                       });
         },

         // Prompt the user to either create a new feed, or reuse an existing one.
         function(done) {

            if (existingFeeds && existingFeeds.length > 0) {
               // there are existing feeds, so list them for the user and ask whether she wants to reuse one, or create
               // a new one
               var ask = function() {
                  printMessage("You have existing feeds for this device.  Please enter the number for the feed");
                  console.log("which should receive the upload.  Or, enter 0 to create a new feed.");
                  existingFeeds.forEach(function(feed, index) {
                     console.log("   " + (index + 1) + ") " + feed.name);
                  });
                  cli.question("Your selection: ", function(val) {
                     val = parseInt(trim(val));
                     if (!isNaN(val) && val >= 0 && val <= existingFeeds.length) {
                        if (val == 0) {
                           createFeed(function(feed) {
                              feedToReceiveUpload = feed;
                              done();
                           });
                        }
                        else {
                           feedToReceiveUpload = existingFeeds[val - 1];
                           done();
                        }
                     }
                     else {
                        printMessage("Invalid selection, please try again.");
                        ask();
                     }
                  });
               };

               ask();
            }
            else {
               // no feeds yet for this device, so prompt the user to create one
               printMessage("No feeds exist yet for this device, so we'll create one now...");

               createFeed(function(feed) {
                  feedToReceiveUpload = feed;
                  done();
               });
            }
         },

         function(done) {
            // Create a temp file for the JSON, and then convert the CSV to JSON and write to the temp file
            printMessage("Converting to JSON...");
            TempFile.create({ prefix : 'flamingo_import_', suffix : '.json' },
                  function(createTempFileErr, theTempFile) {
                     tempFile = theTempFile;

                     if (createTempFileErr) {
                        abort("Failed to create the temp file required for converting the CSV to JSON. Aborting to to error: " + createTempFileErr);
                     }
                     else {
                        // write the JSON prefix
                        fs.appendFileSync(tempFile.path, '{"channel_names":["temperature", "conductivity", "voltage"], "data":[' + os.EOL);

                        // create a stream reader for the CSV, and set it up to append to the temp file
                        // Got this from http://stackoverflow.com/a/32599033/703200
                        var rl = require('readline').createInterface({
                           input : fs.createReadStream(filePath)
                        });

                        // convert the line to JSON and then append to the temp file
                        rl.on('line', function(line) {
                           // split and trim each field
                           var values = line.split(',').map(function(item) {
                              return trim(item);
                           });

                           if (values.length >= NUM_FIELDS_PER_LINE) {

                              // pick out the values for computing the checksum, and for building the JSON record, if valid
                              var timestamp = parseFloat(values[2]);
                              var temperature = parseFloat(values[4]);
                              var conductivity = parseFloat(values[5]);
                              var voltage = parseFloat(values[7]);
                              var errorCodes = parseFloat(values[6]);
                              var expectedChecksum = parseInt(values[8]);

                              // first check whether there was an error
                              if (errorCodes > 0) {
                                 console.log("Ignoring line due to non-zero error code: " + line);
                              }
                              else {
                                 // now compute and check the checksum
                                 var actualChecksum = computeCrc(temperature, conductivity, voltage, errorCodes);
                                 if (expectedChecksum == actualChecksum) {
                                    var jsonLine = JSON.stringify([timestamp, temperature, conductivity, voltage]) + "," + os.EOL;
                                    fs.appendFileSync(tempFile.path, jsonLine);
                                 }
                                 else {
                                    console.log("Skipping line due to invalid checksum: " + line);
                                 }
                              }
                           }
                           else {
                              console.log("Skipping invalid line (wrong number of fields): " + line);
                           }
                        });

                        rl.on('close', function() {
                           // write the JSON suffix
                           fs.appendFileSync(tempFile.path, '[]]}' + os.EOL);

                           // close the temp file
                           fs.closeSync(tempFile.fd);

                           done();
                        });
                     }
                  });
         }
      ],

      function() {
         printMessage("Uploading...");
         superagent
               .put(ESDR_API_ROOT_URL + "/feeds/" + feedToReceiveUpload.apiKey)
               .send(require(tempFile.path))
               .end(function(err, res) {
                       tempFile.cleanup();
                       cli.close();
                       if (err) {
                          abort("Failed to upload due to error: " + err);
                       }
                       else {
                          printMessage("Upload successful! You can view the data by viewing this URL in your browser:");
                          printMessage("file://" + path.resolve('./plot.html') + "?feed=" + (feedToReceiveUpload.isPublic ? feedToReceiveUpload.id : feedToReceiveUpload.apiKeyReadOnly));

                          printMessage("Bye!");
                       }
                    });
      }
);
