/**
 * The theme's manifest, typed by hand rather than inferred.
 *
 * Vite bundles the JSON as data, so what is imported is the theme's own file.
 * `tsc` is not asked to read it: it is 450 KB of table, and letting the compiler
 * build a literal type for every key would add a real cost to every typecheck.
 * The shape here is the part of it this app uses — the tables a lookup needs and
 * the definitions that turn a name into an icon file.
 *
 * `material-icon-theme` ships this file at `dist/material-icons.json` with no
 * `exports` map, which is what makes the deep path below resolvable.
 */
declare module 'material-icon-theme/dist/material-icons.json' {
  export interface IconManifest {
    /** Icon names by file name. Mostly lower case, with a handful of exceptions. */
    fileNames: Record<string, string>;
    /** Icon names by extension, including multi-part ones like `test.ts`. */
    fileExtensions: Record<string, string>;
    /** Icon names by folder name. */
    folderNames: Record<string, string>;
    /** The theme's answer for a file nothing matched. */
    file: string;
    /** The theme's answer for a folder nothing matched. */
    folder: string;
    /** The names drawn differently on a light background, consulted first. */
    light: {
      fileNames: Record<string, string>;
      fileExtensions: Record<string, string>;
      folderNames: Record<string, string>;
    };
    /** What each name is drawn as: a path to one of the theme's own SVGs. */
    iconDefinitions: Record<string, { iconPath: string }>;
  }

  const manifest: IconManifest;
  export default manifest;
}
