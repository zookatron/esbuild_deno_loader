import { ModuleEntry, NpmPackageEntry } from "./deno.ts";

export class InfoCache {
  public modules = new Map<string, ModuleEntry>();
  public npmPackages = new Map<string, NpmPackageEntry>();
}
