import { AdriObjectMetadata } from "./adri-object-metadata";
import { AdriRoutable, RouteMetadata } from "./route-metadata";
import { IconMetadata } from "./icon-metadata";
import { ObjectMetadata } from "./object-metadata";
import { IconIsRequiredException, ObjectIsRequiredException, ApiNameIsRequiredException, RouteIsRequiredException } from "./exceptions";

export abstract class TabMetadata implements AdriRoutable, AdriObjectMetadata {
  public readonly icon: IconMetadata;
  public readonly section?: string;
  public readonly order?: number;

  constructor(icon: IconMetadata, section?: string, order?: number) {
    if (!icon) {
      throw new IconIsRequiredException();
    }
    this.icon = icon;
    this.section = section;
    this.order = order;
  }

  public abstract getApiName(): string;
  public abstract getLabel(): string;
  public abstract getHref(): string;
  public abstract getTarget(): string | undefined;

  // We add this for backwards compatibility with UI mapping
  get slug() { return this.getApiName(); }
}

export class ObjectTabMetadata extends TabMetadata {
  public readonly object: ObjectMetadata;

  constructor(object: ObjectMetadata, section?: string, order?: number) {
    if (!object) {
      throw new ObjectIsRequiredException();
    }
    super(object.icon, section, order);
    this.object = object;
  }

  public getApiName(): string {
    return this.object.route.getApiName ? this.object.route.getApiName() : this.object.apiName;
  }

  public getLabel(): string {
    return this.object.route.getLabel();
  }

  public getHref(): string {
    return this.object.route.getHref();
  }

  public getTarget(): string | undefined {
    return this.object.route.getTarget();
  }
}

export class RouteTabMetadata extends TabMetadata {
  public readonly apiName: string;
  public readonly route: RouteMetadata;

  constructor(apiName: string, route: RouteMetadata, section?: string, order?: number) {
    super(route?.icon, section, order);
    if (!apiName || apiName.trim() === "") {
      throw new ApiNameIsRequiredException();
    } else if (!route) {
      throw new RouteIsRequiredException();
    }
    this.apiName = apiName;
    this.route = route;
  }

  public getApiName(): string {
    return this.apiName;
  }

  public getLabel(): string {
    return this.route.getLabel();
  }

  public getHref(): string {
    return this.route.getHref();
  }

  public getTarget(): string | undefined {
    return this.route.getTarget();
  }
}
