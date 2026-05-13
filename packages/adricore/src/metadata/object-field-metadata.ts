import { AdriObjectMetadata } from "./adri-object-metadata";
import { ObjectFieldDataTypes } from "./enums";
import type { ObjectMetadata } from "./object-metadata";
import type { ObjectRelationshipMetadata } from "./object-relationship-metadata";
import type { PicklistMetadata } from "./picklist-metadata";
import { 
  ObjectRelationshipMetadataIsRequiredException, 
  SourceObjectIsRequiredException, 
  PicklistOptionsIsRequiredException, 
  PicklistOptionsRequireAtleastOneException 
} from "./exceptions";

export interface ObjectFieldMetadataOptions {
  readOnly?: boolean;
  required?: boolean;
  relationship?: ObjectRelationshipMetadata;
  picklist?: PicklistMetadata;
  sourceObject?: ObjectMetadata;
}

export class ObjectFieldMetadata implements AdriObjectMetadata {
  public sourceObject?: ObjectMetadata;
  public readonly apiName: string;
  public readonly label: string;
  public readonly readOnly: boolean;
  public readonly required: boolean;
  public readonly dataType: ObjectFieldDataTypes;
  public picklist?: PicklistMetadata;
  public relationship?: ObjectRelationshipMetadata;

  constructor(
    apiName: string,
    label: string,
    dataType: ObjectFieldDataTypes,
    options?: ObjectFieldMetadataOptions
  ) {
    this.readOnly = options?.readOnly ?? false;
    this.required = options?.required ?? false;

    switch (dataType) {
      case ObjectFieldDataTypes.Reference:
        if (!options?.relationship) {
          throw new ObjectRelationshipMetadataIsRequiredException();
        } else if (!options?.sourceObject) {
          throw new SourceObjectIsRequiredException();
        }

        this.relationship = options.relationship;
        // In order to call setSourceData on relationship, we pass the sourceObject and this field
        this.relationship.setSourceData(options.sourceObject, this);
        break;

      case ObjectFieldDataTypes.Picklist:
      case ObjectFieldDataTypes.MultiPicklist:
        if (!options?.picklist) {
          throw new PicklistOptionsIsRequiredException();
        } else if (options.picklist.options.size === 0) {
          throw new PicklistOptionsRequireAtleastOneException();
        }
        
        this.picklist = options.picklist;
        break;
    }
    
    this.sourceObject = options?.sourceObject;
    this.apiName = apiName;
    this.label = label;
    this.dataType = dataType;
  }

  public getApiName(): string {
    return this.apiName;
  }

  public clone(sourceObject: ObjectMetadata): ObjectFieldMetadata {
    if (!sourceObject) {
      throw new SourceObjectIsRequiredException();
    }
    const clonedField = new ObjectFieldMetadata(
      this.apiName,
      this.label,
      this.dataType,
      {
        readOnly: this.readOnly,
        required: this.required,
        relationship: this.relationship,
        picklist: this.picklist,
        sourceObject: sourceObject,
      }
    );
    return clonedField;
  }
}
