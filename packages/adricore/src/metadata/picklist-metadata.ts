import { OptionsIsRequiredException, TooManyPickOptionDefaultsException } from "./exceptions";

export class PicklistOptionMetadata {
  public readonly value: string;
  public readonly label: string;
  public readonly isDefault: boolean;

  constructor(value: string, label: string, isDefault: boolean = false) {
    this.value = value;
    this.label = label;
    this.isDefault = isDefault;
  }
}

export class PicklistMetadata {
  public readonly options: Map<string, PicklistOptionMetadata> = new Map<string, PicklistOptionMetadata>();

  constructor(options: PicklistOptionMetadata[]) {
    if (!options) {
      throw new OptionsIsRequiredException();
    }
    let defaultCount = 0;
    for (const option of options) {
      if (option.isDefault) {
        defaultCount++;
        if (defaultCount > 1) {
          throw new TooManyPickOptionDefaultsException();
        }
      }
      this.options.set(option.value, option);
    }
  }
}
