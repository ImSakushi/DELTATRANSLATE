const { build } = require("./package.json");
const bundled = process.env.DELTATRANSLATE_EDITION !== "standard";
const config = structuredClone(build);
config.extraMetadata = { ...config.extraMetadata, bundledGit: bundled };
config.publish = config.publish.map(provider => ({ ...provider, channel: bundled ? "bundled" : "latest" }));
config.generateUpdatesFilesForAllChannels = false;
if (bundled) {
  for (const key of ["nsis", "portable", "mac", "linux"]) {
    config[key].artifactName = config[key].artifactName.replace("${productName}", "${productName}-Avec-Git");
  }
} else {
  config.extraResources = config.extraResources.filter(resource => resource.to !== "tools");
}
module.exports = config;
