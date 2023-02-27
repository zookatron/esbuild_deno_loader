import { esbuild, fromFileUrl } from "../deps.ts";
import * as deno from "./deno.ts";
import { mediaTypeToLoader, transformRawIntoContent } from "./shared.ts";
import { InfoCache } from "./cache.ts";

export interface LoadOptions {
  importMapURL?: URL;
}

export async function load(
  infoCache: InfoCache,
  url: URL,
  options: LoadOptions,
): Promise<esbuild.OnLoadResult | null> {
  switch (url.protocol) {
    case "http:":
    case "https:":
    case "data:":
    case "npm:":
      return await loadFromCLI(infoCache, url, options);
    case "file:": {
      const res = await loadFromCLI(infoCache, url, options);
      res.watchFiles = [fromFileUrl(url.href)];
      return res;
    }
  }
  return null;
}

async function loadFromCLI(
  infoCache: InfoCache,
  specifier: URL,
  options: LoadOptions,
): Promise<esbuild.OnLoadResult> {
  const specifierRaw = specifier.href;
  if (!infoCache.modules.has(specifierRaw)) {
    const { modules, redirects, npmPackages } = await deno.info(specifier, {
      importMap: options.importMapURL?.href,
    });
    for (const module of modules) {
      infoCache.modules.set(module.specifier, module);
    }
    for (const [packageName, packageDetails] of Object.entries(npmPackages)) {
      infoCache.npmPackages.set(packageName, packageDetails);
    }
    for (const [specifier, redirect] of Object.entries(redirects)) {
      const redirected = infoCache.modules.get(redirect);
      if (!redirected) {
        throw new TypeError("Unreachable.");
      }
      infoCache.modules.set(specifier, redirected);
    }
  }

  const module = infoCache.modules.get(specifierRaw);
  if (!module) {
    throw new TypeError("Unreachable.");
  }

  if (module.error) throw new Error(module.error);

  let filePath, mediaType;
  if(specifier.protocol === "npm:") {
    const npmPackage = infoCache.npmPackages.get(module.npmPackage);
    if (!npmPackage) {
      throw new TypeError("Unreachable.");
    }

    const globalInfo = await deno.globalInfo();
    const packageFolder = `${globalInfo.npmCache}/registry.npmjs.org/${npmPackage.name}/${npmPackage.version}`;
    const packageJson = JSON.parse(await Deno.readTextFile(`${packageFolder}/package.json`));
    const subPath = specifier.href.includes("/") ?
      specifier.href.split("/").slice(1).join("/") :
      packageJson.main ?? "index.js";

    filePath = `${packageFolder}/${subPath.startsWith("./") ? subPath.slice(2) : subPath}`;
    mediaType = "JavaScript";
  } else {
    if (!module.local) throw new Error("Module not downloaded yet.");
    filePath = module.local;
    mediaType = module.mediaType ?? "Unknown";
  }

  const loader = mediaTypeToLoader(mediaType);

  const raw = await Deno.readFile(filePath);
  const contents = transformRawIntoContent(raw, mediaType);

  return { contents, loader };
}
