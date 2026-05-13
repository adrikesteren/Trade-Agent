import { IconMetadata } from "./icon-metadata";
import { HrefIsRequiredException, LabelIsRequiredException, IconIsRequiredException } from "./exceptions";

export interface AdriRoutable {
  getHref(): string;
  getLabel(): string;
  getTarget(): string | undefined;
}

export class RouteMetadata implements AdriRoutable {
  public readonly icon: IconMetadata;
  public readonly href: string;
  public readonly label: string;
  public readonly target?: string;

  constructor(icon: IconMetadata, href: string, label: string, target?: string) {
    if (!icon) {
      throw new IconIsRequiredException();
    } else if (!href || href.trim() === "") {
      throw new HrefIsRequiredException();
    } else if (!label || label.trim() === "") {
      throw new LabelIsRequiredException();
    }
    
    this.icon = icon;
    this.href = href;
    this.label = label;
    this.target = target;
  }

  public getLabel(): string {
    return this.label;
  }

  public getHref(): string {
    return this.href;
  }

  public getTarget(): string | undefined {
    return this.target;
  }
}
