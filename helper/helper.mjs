// src/launch.ts
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// src/release.ts
import { createHash, createPublicKey, verify } from "node:crypto";
var releaseDigest = (bytes) => createHash("sha256").update(Buffer.from(bytes).toString("latin1").replace(/\r\n/g, "\n"), "latin1").digest("hex");
function parseManifest(text) {
  try {
    const value = JSON.parse(text);
    if (typeof value.name !== "string" || typeof value.version !== "string" || typeof value.bundle !== "string") return null;
    if (!value.files || typeof value.files !== "object" || typeof value.files[value.bundle] !== "string") return null;
    return /^[\w.-]+\.mjs$/.test(value.bundle) ? value : null;
  } catch {
    return null;
  }
}
function signedBy(keys, manifest, signature) {
  const data = Buffer.from(manifest.replace(/\r\n/g, "\n"), "utf8");
  const sig = Buffer.from(signature.trim(), "base64");
  return keys.some((key) => {
    try {
      return verify(null, data, createPublicKey({ key: Buffer.from(key, "base64"), format: "der", type: "spki" }), sig);
    } catch {
      return false;
    }
  });
}
function checkRelease(keys, manifestText, bundle, signature) {
  if (manifestText === null) return { ok: false, reason: "release.json is missing" };
  const manifest = parseManifest(manifestText);
  if (!manifest) return { ok: false, reason: "release.json is not a release manifest" };
  if (bundle === null) return { ok: false, reason: `${manifest.bundle} is missing` };
  if (releaseDigest(bundle) !== manifest.files[manifest.bundle]) return { ok: false, reason: `${manifest.bundle} is not the released ${manifest.version}` };
  if (keys.length === 0) return { ok: true, manifest };
  if (signature === null) return { ok: false, reason: "release.sig is missing: this copy is not a signed release" };
  return signedBy(keys, manifestText, signature) ? { ok: true, manifest } : { ok: false, reason: "release.sig does not match a CommonRig release key" };
}

// src/release-keys.ts
var RELEASE_KEYS = ["MCowBQYDK2VwAyEAi8y0ShXULz6qfSv9l7mpyj8fZqgZO1b00YJwYg6Yozc="];

// src/launch.ts
var read = (path) => {
  try {
    return readFileSync(path);
  } catch {
    return null;
  }
};
var bundleName = (manifest) => {
  try {
    const name = manifest ? JSON.parse(manifest).bundle : null;
    return typeof name === "string" && /^[\w.-]+\.mjs$/.test(name) ? name : null;
  } catch {
    return null;
  }
};
async function launch(launcherUrl, refused) {
  const here = dirname(fileURLToPath(launcherUrl));
  const manifest = read(join(here, "release.json"))?.toString("utf8") ?? null;
  const name = bundleName(manifest);
  const check = checkRelease(RELEASE_KEYS, manifest, name ? read(join(here, name)) : null, read(join(here, "release.sig"))?.toString("utf8") ?? null);
  if (!check.ok || !name) return refused(check.ok ? "no bundle named" : check.reason);
  await import(pathToFileURL(join(here, name)).href);
}
var refusalLine = (reason) => `CommonRig: not running this copy: ${reason}. Reinstall the plugin from its release.
`;

// src/launch-helper.ts
await launch(import.meta.url, (reason) => {
  process.stderr.write(refusalLine(reason));
  process.exitCode = 1;
});
