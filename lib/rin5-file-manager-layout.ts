/**
 * Class names of the file manager parts that change for a phone. Standard
 * Ycode gets exactly its original classes at every width (an iPad at 744 px
 * keeps the folder sidebar, the type filter and SVG). Only in the rin5 client
 * space does the sidebar give its width to the grid below md, and the type
 * filter and SVG step aside below sm.
 */
export type FileManagerLayout = Readonly<{
  sidebar: string
  typeFilter: string
  separator: string
  svgButton: string | undefined
  gridHeader: string
}>

const STANDARD: FileManagerLayout = {
  sidebar: 'w-64 border-r h-full overflow-y-auto px-4',
  typeFilter: 'w-35 justify-between gap-1 font-normal',
  separator: 'h-7! shrink-0 mx-0.5',
  svgButton: undefined,
  gridHeader: 'flex items-center justify-between gap-2 min-h-14 shrink-0',
}

const RIN5_CUSTOMER: FileManagerLayout = {
  sidebar: 'hidden w-64 border-r h-full overflow-y-auto px-4 md:block',
  typeFilter: 'hidden w-35 justify-between gap-1 font-normal sm:inline-flex',
  separator: 'hidden h-7! shrink-0 mx-0.5 sm:block',
  svgButton: 'hidden sm:inline-flex',
  gridHeader: 'flex flex-wrap items-center justify-between gap-x-2 gap-y-1 min-h-14 shrink-0 py-2',
}

export function fileManagerLayout(rin5Customer: boolean): FileManagerLayout {
  return rin5Customer ? RIN5_CUSTOMER : STANDARD
}
