import * as Path from "node:path";
import { KeplerService } from "@vialactea-works/kepler-core";

export const resolveProjectDataPath = (
  sourcePath: string,
  cwd = process.cwd(),
): string => {
  const resolvedSourcePath = Path.resolve(cwd, sourcePath);
  let dataPath = resolvedSourcePath;
  while (true) {
    const name = Path.basename(dataPath);
    if (name === ".hamilton" || name === ".kepler") {
      const relativePath = Path.relative(dataPath, resolvedSourcePath);
      const canonicalRoot = new KeplerService().projectDataPath(
        Path.dirname(dataPath),
      );
      return relativePath === ""
        ? canonicalRoot
        : Path.join(canonicalRoot, relativePath);
    }
    const parent = Path.dirname(dataPath);
    if (parent === dataPath) return sourcePath;
    dataPath = parent;
  }
};
