import type { ObjectMetadata } from "@/models/types";
import { assetsObject } from "@/models/assets";
import { executorsObject } from "@/models/executors";
import { logsObject } from "@/models/logs";
import { tasksObject } from "@/models/tasks";

const OBJECTS: ObjectMetadata[] = [assetsObject, executorsObject, tasksObject, logsObject];

const bySlug = new Map<string, ObjectMetadata>(OBJECTS.map((o) => [o.slug, o]));

export function getObjectMetadataBySlug(slug: string): ObjectMetadata | undefined {
  return bySlug.get(slug);
}

export function listRegisteredObjectSlugs(): string[] {
  return [...bySlug.keys()];
}
