import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export async function resolve(specifier, context, nextResolve) {
  if (specifier.endsWith(".svg?raw") || specifier.endsWith(".svg?url")) {
    return {
      url: new URL(specifier, context.parentURL).href,
      shortCircuit: true,
    };
  }

  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.includes(".svg?raw")) {
    const assetUrl = new URL(url);
    assetUrl.search = "";
    const svg = await readFile(fileURLToPath(assetUrl), "utf8");
    return {
      format: "module",
      shortCircuit: true,
      source: `export default ${JSON.stringify(svg)};`,
    };
  }

  if (url.includes(".svg?url")) {
    const assetUrl = new URL(url);
    assetUrl.search = "";
    return {
      format: "module",
      shortCircuit: true,
      source: `export default ${JSON.stringify(assetUrl.href)};`,
    };
  }

  return nextLoad(url, context);
}
