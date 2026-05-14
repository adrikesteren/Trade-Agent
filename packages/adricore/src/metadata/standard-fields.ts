import { ObjectFieldDataTypes } from "./enums";
import { ObjectFieldMetadata } from "./object-field-metadata";
import { ObjectFieldMetadataRegistry } from "./registries";

/**
 * Fields cloned onto every {@link ObjectMetadataBase}: audit columns common to
 * both regular {@link ObjectMetadata} and {@link HighVolumeObjectMetadata}.
 *
 * Columns: `id`, `created_by`, `created_at`, `updated_by`, `updated_at`.
 */
export const baseObjectFieldRegistry = new ObjectFieldMetadataRegistry([
  new ObjectFieldMetadata("id", "Id", ObjectFieldDataTypes.Id, {
    readOnly: true,
    required: true,
  }),
  new ObjectFieldMetadata("created_by", "Created By", ObjectFieldDataTypes.Id, {
    readOnly: true,
  }),
  new ObjectFieldMetadata(
    "created_at",
    "Created At",
    ObjectFieldDataTypes.Datetime,
    { readOnly: true, required: true },
  ),
  new ObjectFieldMetadata("updated_by", "Updated By", ObjectFieldDataTypes.Id, {
    readOnly: true,
  }),
  new ObjectFieldMetadata(
    "updated_at",
    "Updated At",
    ObjectFieldDataTypes.Datetime,
    { readOnly: true },
  ),
]);

/**
 * Fields cloned onto every {@link ObjectMetadata}: the base audit set plus the
 * user-facing `name` column. {@link HighVolumeObjectMetadata} skips `name`.
 */
export const standardObjectFieldRegistry = new ObjectFieldMetadataRegistry([
  new ObjectFieldMetadata("id", "Id", ObjectFieldDataTypes.Id, {
    readOnly: true,
    required: true,
  }),
  new ObjectFieldMetadata("name", "Name", ObjectFieldDataTypes.String, {
    required: true,
  }),
  new ObjectFieldMetadata("created_by", "Created By", ObjectFieldDataTypes.Id, {
    readOnly: true,
  }),
  new ObjectFieldMetadata(
    "created_at",
    "Created At",
    ObjectFieldDataTypes.Datetime,
    { readOnly: true, required: true },
  ),
  new ObjectFieldMetadata("updated_by", "Updated By", ObjectFieldDataTypes.Id, {
    readOnly: true,
  }),
  new ObjectFieldMetadata(
    "updated_at",
    "Updated At",
    ObjectFieldDataTypes.Datetime,
    { readOnly: true },
  ),
]);
