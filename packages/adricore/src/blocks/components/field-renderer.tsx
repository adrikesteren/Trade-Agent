import * as React from "react";
import { ObjectFieldMetadata, ObjectFieldDataTypes } from "@repo/adricore/metadata";
import { Input } from "./input";
import { Select } from "./select";
import { Checkbox } from "./checkbox";
import { FormElement } from "./form-element";
import { Lookup } from "./lookup";

export class FieldRenderer {
  /**
   * Generates a read-only output representation of a field.
   */
  static createOutput(field: ObjectFieldMetadata, value: any): React.ReactNode {
    if (value === undefined || value === null) {
      return <span className="adri-text-muted">-</span>;
    }

    switch (field.dataType) {
      case ObjectFieldDataTypes.Boolean:
        return (
          <Checkbox 
            checked={!!value} 
            disabled 
            aria-readonly="true" 
          />
        );
      
      case ObjectFieldDataTypes.Reference:
        if (field.relationship) {
          const targetUrl = `${field.relationship.referenceObject.route.getHref()}/${value}`;
          const displayLabel = typeof value === 'object' && value.name ? value.name : value;
          return (
            <a href={targetUrl} className="adri-link">
              {displayLabel}
            </a>
          );
        }
        return String(value);

      case ObjectFieldDataTypes.Picklist:
      case ObjectFieldDataTypes.MultiPicklist:
        if (field.picklist) {
          const option = field.picklist.options.get(String(value));
          return option ? option.label : String(value);
        }
        return String(value);
        
      case ObjectFieldDataTypes.Date:
      case ObjectFieldDataTypes.Datetime:
        try {
          return new Date(value).toLocaleString();
        } catch (e) {
          return String(value);
        }

      default:
        return String(value);
    }
  }

  /**
   * Generates an input element wrapped in a FormElement for data entry.
   */
  static createInput(
    field: ObjectFieldMetadata, 
    value: any, 
    onChange: (value: any) => void,
    error?: string
  ): React.ReactNode {
    const commonId = `field-${field.apiName}`;
    const commonProps = {
      id: commonId,
      disabled: field.readOnly,
      required: field.required,
    };

    let inputElement: React.ReactNode;

    switch (field.dataType) {
      case ObjectFieldDataTypes.Boolean:
        return (
          <Checkbox 
            {...commonProps}
            label={field.label}
            checked={!!value}
            onCheckedChange={(checked) => onChange(checked)}
          />
        );
        
      case ObjectFieldDataTypes.Picklist:
        inputElement = (
          <Select 
            {...commonProps} 
            value={value || ""} 
            onChange={(e) => onChange(e.target.value)}
          >
            <option value="" disabled>Select an option</option>
            {field.picklist && Array.from(field.picklist.options.values()).map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </Select>
        );
        break;

      case ObjectFieldDataTypes.Reference:
        inputElement = (
          <Lookup 
            {...commonProps}
            relationship={field.relationship}
            value={value || ""}
            onChange={(e) => onChange(e.target.value)}
          />
        );
        break;

      case ObjectFieldDataTypes.Integer:
      case ObjectFieldDataTypes.Decimal:
        inputElement = (
          <Input 
            {...commonProps} 
            type="number"
            value={value ?? ""} 
            onChange={(e) => onChange(e.target.value)} 
          />
        );
        break;

      default:
        inputElement = (
          <Input 
            {...commonProps} 
            type="text"
            value={value ?? ""} 
            onChange={(e) => onChange(e.target.value)} 
          />
        );
        break;
    }

    return (
      <FormElement 
        id={commonId} 
        label={field.label} 
        required={field.required} 
        error={error}
      >
        {inputElement}
      </FormElement>
    );
  }
}
