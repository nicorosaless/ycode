import { translateCustomerCopy } from './rin5-customer-copy'

export type UploadFailureNotice = Readonly<{ title: string; description: string }>

/**
 * What the rin5 customer is told when some uploads failed. Outside the client
 * space there is no notice (null): standard Ycode keeps its own behavior.
 * The file manager only offers photos to the customer, so the advice names
 * the photo formats that upload.
 */
export function uploadFailureNotice(failedNames: readonly string[], rin5Customer: boolean): UploadFailureNotice | null {
  if (!rin5Customer || failedNames.length === 0) return null
  const description = translateCustomerCopy('Use a JPG, PNG or WebP photo under 50 MB and try again.', true)
  return failedNames.length === 1
    ? { title: translateCustomerCopy('{name} could not be uploaded', true, { name: failedNames[0] }), description }
    : { title: translateCustomerCopy('{count} files could not be uploaded', true, { count: failedNames.length }), description }
}
