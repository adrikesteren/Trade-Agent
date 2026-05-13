export class OptionsIsRequiredException extends Error {
  constructor(message = "Options are required for Picklist.") {
    super(message);
    this.name = "OptionsIsRequiredException";
  }
}

export class TooManyPickOptionDefaultsException extends Error {
  constructor(message = "Too many default options for Picklist.") {
    super(message);
    this.name = "TooManyPickOptionDefaultsException";
  }
}

export class ObjectRelationshipMetadataIsRequiredException extends Error {
  constructor(message = "ObjectRelationshipMetadata is required for Reference fields.") {
    super(message);
    this.name = "ObjectRelationshipMetadataIsRequiredException";
  }
}

export class SourceObjectIsRequiredException extends Error {
  constructor(message = "Source Object is required.") {
    super(message);
    this.name = "SourceObjectIsRequiredException";
  }
}

export class SourceFieldIsRequiredException extends Error {
  constructor(message = "Source Field is required.") {
    super(message);
    this.name = "SourceFieldIsRequiredException";
  }
}

export class PicklistOptionsIsRequiredException extends Error {
  constructor(message = "PicklistOptions metadata is required.") {
    super(message);
    this.name = "PicklistOptionsIsRequiredException";
  }
}

export class PicklistOptionsRequireAtleastOneException extends Error {
  constructor(message = "At least one PicklistOption is required.") {
    super(message);
    this.name = "PicklistOptionsRequireAtleastOneException";
  }
}

export class SingularIsRequiredException extends Error {
  constructor(message = "Singular label is required.") {
    super(message);
    this.name = "SingularIsRequiredException";
  }
}

export class PluralIsRequiredException extends Error {
  constructor(message = "Plural label is required.") {
    super(message);
    this.name = "PluralIsRequiredException";
  }
}

export class SchemaIsRequiredException extends Error {
  constructor(message = "Schema is required.") {
    super(message);
    this.name = "SchemaIsRequiredException";
  }
}

export class TableIsRequiredException extends Error {
  constructor(message = "Table is required.") {
    super(message);
    this.name = "TableIsRequiredException";
  }
}

export class ApiNameIsRequiredException extends Error {
  constructor(message = "ApiName is required.") {
    super(message);
    this.name = "ApiNameIsRequiredException";
  }
}

export class LabelIsRequiredException extends Error {
  constructor(message = "Label is required.") {
    super(message);
    this.name = "LabelIsRequiredException";
  }
}

export class TargetObjectIsRequiredException extends Error {
  constructor(message = "Target Object is required.") {
    super(message);
    this.name = "TargetObjectIsRequiredException";
  }
}

export class SlugIsRequiredException extends Error {
  constructor(message = "Slug is required.") {
    super(message);
    this.name = "SlugIsRequiredException";
  }
}

export class IconIsRequiredException extends Error {
  constructor(message = "Icon is required.") {
    super(message);
    this.name = "IconIsRequiredException";
  }
}

export class ObjectIsRequiredException extends Error {
  constructor(message = "Object is required.") {
    super(message);
    this.name = "ObjectIsRequiredException";
  }
}

export class HrefIsRequiredException extends Error {
  constructor(message = "Href is required.") {
    super(message);
    this.name = "HrefIsRequiredException";
  }
}

export class RouteIsRequiredException extends Error {
  constructor(message = "Route is required.") {
    super(message);
    this.name = "RouteIsRequiredException";
  }
}

export class TabIsRequiredException extends Error {
  constructor(message = "Tab is required.") {
    super(message);
    this.name = "TabIsRequiredException";
  }
}
