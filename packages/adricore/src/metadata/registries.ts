import type { AdriObjectMetadata } from "./adri-object-metadata";
import type { ObjectMetadataBase } from "./object-metadata-base";
import type { ObjectRelationshipMetadata } from "./object-relationship-metadata";
import type { ObjectFieldMetadata } from "./object-field-metadata";
import type { IconMetadata } from "./icon-metadata";
import type { TabMetadata } from "./tab-metadata";
import type { AppMetadata } from "./app-metadata";
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

export class ObjectMetadataRegistry extends AdriObjectRegistry<ObjectMetadataBase> {
  constructor(objects?: ObjectMetadataBase[]) {
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

  public clone(sourceObject: ObjectMetadataBase): ObjectFieldMetadataRegistry {
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

export class IconMetadataRegistry extends AdriObjectRegistry<IconMetadata> {
  constructor(icons?: IconMetadata[]) {
    super(icons);
  }
}

export class TabMetadataRegistry extends AdriObjectRegistry<TabMetadata> {
  constructor(tabs?: TabMetadata[]) {
    super(tabs);
  }
}

export class AppMetadataRegistry extends AdriObjectRegistry<AppMetadata> {
  constructor(apps?: AppMetadata[]) {
    super(apps);
  }
}
