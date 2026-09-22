const requestedVersion = Bun.argv[2]?.replace(/^v/, "");
const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

const packageFiles = Array.from(new Bun.Glob("packages/*/package.json").scanSync(".")).sort();
const packages = await Promise.all(packageFiles.map(async (path) => ({
  path,
  manifest: await Bun.file(path).json() as { name?: string; version?: string; private?: boolean; dependencies?: Record<string, string> },
})));
const published = packages.filter(({ manifest }) => !manifest.private);

if (published.length === 0) throw new Error("No publishable packages found");

const versions = new Set<string>();
for (const { path, manifest } of published) {
  if (!manifest.name?.startsWith("@lunar/")) throw new Error(`${path} must use an @lunar package name`);
  if (!manifest.version || !semver.test(manifest.version)) throw new Error(`${path} has an invalid semantic version`);
  versions.add(manifest.version);
  for (const [dependency, range] of Object.entries(manifest.dependencies ?? {})) {
    if (dependency.startsWith("@lunar/") && range !== "workspace:*") {
      throw new Error(`${path} must use workspace:* for ${dependency}`);
    }
  }
}

if (versions.size !== 1) throw new Error(`Publishable packages must share one release version; found ${[...versions].join(", ")}`);
const [version] = versions;
if (requestedVersion && requestedVersion !== version) {
  throw new Error(`Release tag v${requestedVersion} does not match package version v${version}`);
}

console.log(`Release check passed for ${published.length} packages at v${version}`);
