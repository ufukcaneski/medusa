import type { SchemaObject } from "@/types/openapi"
import TagOperationParametersDefault from "../Default"
import dynamic from "next/dynamic"
import type { TagOperationParametersProps } from "../.."
import type { TagsOperationParametersNestedProps } from "../../Nested"
import type { DetailsProps } from "@/components/Details"
import checkRequired from "@/utils/check-required"

const TagOperationParameters = dynamic<TagOperationParametersProps>(
  async () => import("../..")
) as React.FC<TagOperationParametersProps>

const TagsOperationParametersNested =
  dynamic<TagsOperationParametersNestedProps>(
    async () => import("../../Nested")
  ) as React.FC<TagsOperationParametersNestedProps>

const Details = dynamic<DetailsProps>(
  async () => import("../../../../../Details")
) as React.FC<DetailsProps>

export type TagOperationParametersObjectProps = {
  name?: string
  schema: SchemaObject
  isRequired?: boolean
  topLevel?: boolean
}

const TagOperationParametersObject = ({
  name,
  schema,
  isRequired,
  topLevel = false,
}: TagOperationParametersObjectProps) => {
  if (schema.type !== "object" || (!schema.properties && !name)) {
    return <></>
  }

  const getPropertyDescriptionElm = (className?: string) => {
    return (
      <TagOperationParametersDefault
        name={name}
        schema={schema}
        isRequired={isRequired}
        className={className}
      />
    )
  }

  const getPropertyParameterElms = (isNested = false) => {
    // sort properties to show required fields first
    const sortedProperties = Object.keys(schema.properties).sort(
      (property1, property2) => {
        schema.properties[property1].isRequired = checkRequired(
          schema,
          property1
        )
        schema.properties[property2].isRequired = checkRequired(
          schema,
          property2
        )

        return schema.properties[property1].isRequired &&
          schema.properties[property2].isRequired
          ? 0
          : schema.properties[property1].isRequired
          ? -1
          : 1
      }
    )
    const content = (
      <>
        {sortedProperties.map((property, index) => (
          <TagOperationParameters
            schemaObject={{
              ...schema.properties[property],
              parameterName: property,
            }}
            key={index}
            isRequired={
              schema.properties[property].isRequired ||
              checkRequired(schema, property)
            }
          />
        ))}
      </>
    )
    return (
      <>
        {isNested && (
          <TagsOperationParametersNested>
            {content}
          </TagsOperationParametersNested>
        )}
        {!isNested && <div>{content}</div>}
      </>
    )
  }

  if (!schema.properties) {
    return getPropertyDescriptionElm("pl-1.5")
  }

  if (topLevel) {
    return getPropertyParameterElms()
  }

  return (
    <Details summaryContent={getPropertyDescriptionElm()}>
      {getPropertyParameterElms(true)}
    </Details>
  )
}

export default TagOperationParametersObject
