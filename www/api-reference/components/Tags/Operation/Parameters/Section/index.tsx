import type { SchemaObject } from "@/types/openapi"
import clsx from "clsx"
import type { TagOperationParametersProps } from ".."
import dynamic from "next/dynamic"

const TagOperationParameters = dynamic<TagOperationParametersProps>(
  async () => import("..")
) as React.FC<TagOperationParametersProps>

type TagsOperationParametersSectionProps = {
  header: string
  subheader?: string
  schema: SchemaObject
}

const TagsOperationParametersSection = ({
  header,
  subheader,
  schema,
}: TagsOperationParametersSectionProps) => {
  return (
    <>
      <div
        className={clsx(
          "border-medusa-border-base dark:border-medusa-border-base-dark border-b border-solid",
          "mb-1"
        )}
      >
        <span className={clsx("uppercase")}>{header}:</span>{" "}
        {subheader && <span>{subheader}</span>}
      </div>
      <TagOperationParameters schemaObject={schema} topLevel={true} />
    </>
  )
}

export default TagsOperationParametersSection
