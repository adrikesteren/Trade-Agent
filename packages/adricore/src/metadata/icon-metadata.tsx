import * as React from "react";
import { AdriObjectMetadata } from "./adri-object-metadata";
import { ApiNameIsRequiredException } from "./exceptions";
import { ListViewObjectIcon } from "../blocks/components/data-display/object-icon";

export type IconRenderOpts = {
  /** Override the rendered letter (defaults to first letter of `apiName`). */
  letter?: string;
  className?: string;
};

export class IconMetadata implements AdriObjectMetadata {
  public readonly apiName: string;

  constructor(apiName: string) {
    if (!apiName || apiName.trim() === "") {
      throw new ApiNameIsRequiredException();
    }
    this.apiName = apiName;
  }

  public getApiName(): string {
    return this.apiName;
  }

  /**
   * Render the Lightning-style object icon (rounded gradient square + letter).
   *
   * Today this resolves to a letter glyph derived from `apiName`. A future
   * iteration can wire this to a centralised icon library (e.g. lucide) by
   * registering a resolver on `@repo/adricore`.
   */
  public CreateIcon(opts?: IconRenderOpts): React.ReactNode {
    const letter = opts?.letter ?? this.apiName.trim().slice(0, 1).toUpperCase();
    return <ListViewObjectIcon letter={letter} className={opts?.className} />;
  }
}
