import { SingularIsRequiredException, PluralIsRequiredException } from "./exceptions";

export class ObjectLabelMetadata {
  public readonly singular: string;
  public readonly plural: string;

  constructor(singular: string, plural: string) {
    if (!singular || singular.trim() === "") {
      throw new SingularIsRequiredException();
    } else if (!plural || plural.trim() === "") {
      throw new PluralIsRequiredException();
    }
    this.singular = singular;
    this.plural = plural;
  }
}
