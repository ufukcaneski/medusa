import React from "react"
import Details from "../../theme/Details"
import clsx from "clsx"
import { MarkdownContent } from "docs-ui"

type TroubleshootingSection = {
  title: string
  content: React.ReactNode
}

type DetailsListProps = {
  sections: TroubleshootingSection[]
} & React.AllHTMLAttributes<HTMLDivElement>

const DetailsList: React.FC<DetailsListProps> = ({ sections }) => {
  return (
    <>
      {sections.map(({ title, content }, index) => (
        <Details
          summary={title}
          key={index}
          className={clsx(index !== 0 && "border-t-0")}
        >
          {React.isValidElement(content) && content}
          {!React.isValidElement(content) && typeof content === "string" && (
            <MarkdownContent>content</MarkdownContent>
          )}
        </Details>
      ))}
    </>
  )
}

export default DetailsList
