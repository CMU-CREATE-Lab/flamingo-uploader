var config = require('nconf');

var userConfigFile = './config-user.json';
config.argv().env();
config.add('global', { type : 'file', file : userConfigFile });

config.defaults(
      {
         "esdr" : {
            "rootUrl" : "https://esdr.cmucreatelab.org",
            "apiRootUrl" : "https://esdr.cmucreatelab.org/api/v1",
         },
         "client" : {
            "name" : "flamingo-uploader-command-line-client",
            "secret" : "flamingo-water-quality-monitor"
         },
         "defaultUser" : {
            "username" : "",
            "password" : ""
         }
      });

module.exports = config;