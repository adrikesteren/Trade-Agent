import type { AdriObjectMetadata } from "./adri-object-metadata";
import type { ObjectMetadata } from "./object-metadata";
import type { ObjectRelationshipMetadata } from "./object-relationship-metadata";
import type { ObjectFieldMetadata } from "./object-field-metadata";
import { SourceObjectIsRequiredException } from "./exceptions";

export abstract class AdriObjectRegistry<T extends AdriObjectMetadata> {
  public readonly registrations: Map<string, T> = new Map<string, T>();

  constructor(registrations?: T[]) {
    if (registrations) {
      this.addAll(registrations);
    }
  }

  public addAll(registrations: T[]): void {
    for (const registration of registrations) {
      this.add(registration);
    }
  }

  public add(registration: T): void {
    this.registrations.set(registration.getApiName(), registration);
  }
}

export class ObjectMetadataRegistry extends AdriObjectRegistry<ObjectMetadata> {
  constructor(objects?: ObjectMetadata[]) {
    super(objects);
  }

  public initialize(): void {
    for (const registration of Array.from(this.registrations.values())) {
      registration.connectRelationships();
    }
  }
}

export class ObjectRelationshipMetadataRegistry extends AdriObjectRegistry<ObjectRelationshipMetadata> {
  constructor(relationships?: ObjectRelationshipMetadata[]) {
    super(relationships);
  }
}

export class ObjectFieldMetadataRegistry extends AdriObjectRegistry<ObjectFieldMetadata> {
  constructor(fields?: ObjectFieldMetadata[]) {
    super(fields);
  }

  public clone(sourceObject: ObjectMetadata): ObjectFieldMetadataRegistry {
    if (!sourceObject) {
      throw new SourceObjectIsRequiredException();
    }
    
    const clonedRegistry = new ObjectFieldMetadataRegistry();
    
    for (const registration of Array.from(this.registrations.values())) {
      clonedRegistry.add(registration.clone(sourceObject));
    }
    
    return clonedRegistry;
  }
}
