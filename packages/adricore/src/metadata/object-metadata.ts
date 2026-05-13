import { AdriObjectMetadata } from "./adri-object-metadata";
import { ObjectLabelMetadata } from "./object-label-metadata";
import { IconMetadata } from "./icon-metadata";
import { ObjectFieldMetadataRegistry, ObjectRelationshipMetadataRegistry } from "./registries";
import { standardObjectFieldRegistry } from "./standard-fields";
import { 
  SchemaIsRequiredException, 
  TableIsRequiredException, 
  ApiNameIsRequiredException, 
  LabelIsRequiredException,
  IconIsRequiredException
} from "./exceptions";

/** NameFieldSpec kept for backwards compatibility with UI */
export type NameFieldSpec =
  | { mode: "manual" }
  | { mode: "autoNumber"; displayFormat: string; startNumber?: number };

export abstract class ObjectMetadata implements AdriObjectMetadata {
  public readonly schema: string;
  public readonly table: string;
  public readonly apiName: string;
  public readonly label: ObjectLabelMetadata;
  public readonly icon: IconMetadata;
  public readonly fieldRegistry: ObjectFieldMetadataRegistry;
  public readonly childRelationships: ObjectRelationshipMetadataRegistry = new ObjectRelationshipMetadataRegistry();

  /** 
   * Optional properties carried over for UI and routing compatibility 
   */
  public idColumn?: string;
  public slug?: string;
  public nameField?: NameFieldSpec;

  constructor(
    schema: string, 
    table: string, 
    apiName: string, 
    label: ObjectLabelMetadata,
    icon: IconMetadata
  ) {
    if (!schema || schema.trim() === "") {
      throw new SchemaIsRequiredException();
    } else if (!table || table.trim() === "") {
      throw new TableIsRequiredException();
    } else if (!apiName || apiName.trim() === "") {
      throw new ApiNameIsRequiredException();
    } else if (!label) {
      throw new LabelIsRequiredException();
    } else if (!icon) {
      throw new IconIsRequiredException();
    }
    
    this.schema = schema;
    this.table = table;
    this.apiName = apiName;
    this.label = label;
    this.icon = icon;
    
    // Default fallback for slug/idColumn based on apiName
    this.slug = apiName;
    this.idColumn = "id";

    // Clone standard fields for this specific object instance
    this.fieldRegistry = standardObjectFieldRegistry.clone(this);
  }

  public getApiName(): string {
    return this.apiName;
  }

  /**
   * Override this method in subclasses to set up relationships.
   * This is called by the ObjectMetadataRegistry during initialization.
   */
  public connectRelationships(): void {
    // Default implementation does nothing
  }
}
