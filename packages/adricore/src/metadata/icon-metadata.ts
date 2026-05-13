import { AdriObjectMetadata } from "./adri-object-metadata";
import { ApiNameIsRequiredException } from "./exceptions";

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
}
