// ../shared/api-contract.ts sits outside frontend/ (single-file contract, no
// package of its own), so Node can't find `zod` from there. Resolve it from
// frontend/node_modules, like tsconfig.json paths / Next do for the app.
import { registerHooks } from "node:module";

const frontendPackage = new URL("../package.json", import.meta.url).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    const fromShared = context.parentURL?.includes("/shared/");
    return nextResolve(
      specifier,
      fromShared && specifier === "zod"
        ? { ...context, parentURL: frontendPackage }
        : context,
    );
  },
});
