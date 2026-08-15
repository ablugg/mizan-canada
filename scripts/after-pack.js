const fs = require("fs");
const path = require("path");

function copyDirSync(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * after-pack hook: runs after electron-builder packages the app but before DMG/NSIS creation.
 *
 * 1. Injects .prisma/client (query engine) which dotfile rules may exclude.
 * 2. Sets +x on bundled Ollama binaries for macOS/Linux.
 */
exports.default = async function afterPack(context) {
  const { appOutDir, electronPlatformName } = context;

  let resourcesDir;
  if (electronPlatformName === "darwin") {
    const entry = fs.readdirSync(appOutDir).find((f) => f.endsWith(".app"));
    if (!entry) {
      console.warn("  [after-pack] Could not find .app bundle in", appOutDir);
      return;
    }
    resourcesDir = path.join(appOutDir, entry, "Contents", "Resources");
  } else {
    resourcesDir = path.join(appOutDir, "resources");
  }

  // 1. Inject .prisma/client into the unpacked area (asar or plain)
  const srcPrisma = path.join(__dirname, "..", "node_modules", ".prisma");
  // With asar enabled, unpacked files go to app.asar.unpacked/; without asar, app/
  const unpackedDir = path.join(resourcesDir, "app.asar.unpacked");
  const plainDir = path.join(resourcesDir, "app");
  const destBase = fs.existsSync(unpackedDir) ? unpackedDir : plainDir;
  const destPrisma = path.join(destBase, "node_modules", ".prisma");
  if (fs.existsSync(srcPrisma)) {
    copyDirSync(srcPrisma, destPrisma);
    console.log("  \u2022 injected .prisma/client into packaged app");
  } else {
    console.warn("  [after-pack] .prisma not found at", srcPrisma);
  }

  // 2. Make the bundled Ollama binary executable on macOS/Linux
  if (electronPlatformName !== "win32") {
    const ollamaDir = path.join(resourcesDir, "ollama", "mac");
    if (fs.existsSync(ollamaDir)) {
      for (const entry of fs.readdirSync(ollamaDir, { withFileTypes: true })) {
        if (entry.isFile()) {
          fs.chmodSync(path.join(ollamaDir, entry.name), 0o755);
        }
      }
      console.log("  \u2022 set ollama/mac/* +x");
    }
  }
};
