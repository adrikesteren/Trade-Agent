import { AdriObjectMetadata } from "./adri-object-metadata";
import { TabMetadataRegistry } from "./registries";
import { ApiNameIsRequiredException, LabelIsRequiredException, TabIsRequiredException } from "./exceptions";

/**
 * HTTP-only cookie used by the host app to remember which `AppMetadata` entry
 * from its `AppMetadataRegistry` is active.
 */
export const ACTIVE_APP_COOKIE_NAME = "adricore_active_app" as const;

/**
 * Registry key to use when the cookie is missing or does not match any entry.
 */
export const DEFAULT_APP_ID = "trade-agent" as const;

export class AppMetadata implements AdriObjectMetadata {
  public readonly apiName: string;
  public readonly label: string;
  public readonly tabRegistry: TabMetadataRegistry;

  constructor(apiName: string, label: string, tabRegistry: TabMetadataRegistry) {
    if (!apiName || apiName.trim() === "") {
      throw new ApiNameIsRequiredException();
    } else if (!label || label.trim() === "") {
      throw new LabelIsRequiredException();
    } else if (!tabRegistry) {
      throw new TabIsRequiredException();
    }
    
    this.apiName = apiName;
    this.label = label;
    this.tabRegistry = tabRegistry;
  }

  public getApiName(): string {
    return this.apiName;
  }

  // Helper for UI iterators
  get tabs() {
    // Ensure tabs are ordered correctly if `order` is present
    const arr = Array.from(this.tabRegistry.registrations.values());
    arr.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    return arr;
  }
}
