import { ObjectFieldDataTypes } from "./enums";
import { ObjectFieldMetadata } from "./object-field-metadata";
import { ObjectFieldMetadataRegistry } from "./registries";

export const standardObjectFieldRegistry = new ObjectFieldMetadataRegistry([
  new ObjectFieldMetadata(
    "id",
    "Id",
    ObjectFieldDataTypes.Id,
    { readOnly: true, required: true }
  ),
  new ObjectFieldMetadata(
    "name",
    "Name",
    ObjectFieldDataTypes.String, // Equivalent to Text
    { required: true }
  ),
  new ObjectFieldMetadata(
    "created_by",
    "Created By",
    ObjectFieldDataTypes.Id, // Or Reference later if connected to auth.users
    { readOnly: true, required: true }
  ),
  new ObjectFieldMetadata(
    "created_at",
    "Created At",
    ObjectFieldDataTypes.Datetime,
    { readOnly: true, required: true }
  ),
  new ObjectFieldMetadata(
    "updated_by",
    "Updated By",
    ObjectFieldDataTypes.Id, // Or Reference later if connected to auth.users
    { readOnly: true, required: true }
  ),
  new ObjectFieldMetadata(
    "updated_at",
    "Updated At",
    ObjectFieldDataTypes.Datetime,
    { readOnly: true, required: true }
  ),
]);
