import { AdriObjectMetadata } from "./adri-object-metadata";
import type { ObjectMetadata } from "./object-metadata";
import type { ObjectFieldMetadata } from "./object-field-metadata";
import { ObjectRelationshipReferenceTypes } from "./enums";
import { 
  TargetObjectIsRequiredException, 
  SlugIsRequiredException, 
  SourceObjectIsRequiredException, 
  SourceFieldIsRequiredException 
} from "./exceptions";

export class ObjectRelationshipMetadata implements AdriObjectMetadata {
  public readonly apiName: string;
  public sourceObject?: ObjectMetadata;
  public readonly referenceObject: ObjectMetadata;
  public readonly referenceType: ObjectRelationshipReferenceTypes;
  public sourceField?: ObjectFieldMetadata;
  public allowTargetObjectDeletion: boolean = true;

  constructor(
    apiName: string, 
    referenceType: ObjectRelationshipReferenceTypes, 
    referenceObject: ObjectMetadata
  ) {
    if (!referenceObject) {
      throw new TargetObjectIsRequiredException();
    } else if (!apiName || apiName.trim() === "") {
      throw new SlugIsRequiredException();
    }
    this.apiName = apiName;
    this.referenceType = referenceType;
    this.referenceObject = referenceObject;
    
    // Add this relationship to the referenceObject's childRelationships registry
    this.referenceObject.childRelationships.add(this);
  }

  public setSourceData(sourceObject: ObjectMetadata, sourceField: ObjectFieldMetadata): void {
    if (!sourceObject) {
      throw new SourceObjectIsRequiredException();
    } else if (!sourceField) {
      throw new SourceFieldIsRequiredException();
    }
    this.sourceObject = sourceObject;
    this.sourceField = sourceField;
  }

  public getApiName(): string {
    return this.apiName;
  }
}
