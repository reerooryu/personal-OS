/**
 * electron-builder afterPack hook: copies the bundled server, migrations and
 * (if present) the private starting record into the app's Resources folder.
 * Runs before signing.
 */
const fs = require("node:fs");
const path = require("node:path");

exports.default = async function afterPack(context) {
  const resources =
    context.electronPlatformName === "darwin"
      ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, "Contents", "Resources")
      : path.join(context.appOutDir, "resources");
  const from = path.join(context.packager.projectDir, "dist-app");
  if (!fs.existsSync(from)) throw new Error("dist-app is missing. Run `npm run package`, not electron-builder directly.");
  fs.cpSync(from, resources, { recursive: true, verbatimSymlinks: true });
  console.log(`  • copied bundled server into ${resources}`);
};
