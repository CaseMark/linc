# Runtime image delivery

Case.dev chat-completion requests automatically upload inline images through
`POST /linc/v1/images` and replace each image URL in the outgoing payload with
a presigned S3 download URL. This runs after extension payload transforms and
covers rendered page reads, tool-result images, pasted images, and CLI file inputs.
The render tool still writes ordinary local files. No attached Vault or visible
Vault object is required.

Native session history retains the original image bytes. Signed URLs live only
in memory, are scoped to the API endpoint, API key, and native session, and are
renewed with five minutes of lifetime remaining. The service reports expiration
bounded by the actual signing credentials. A reopened session submits the same
content hash; the server uses conditional writes to avoid overwrites and extra
object versions. Key rotation uses a new private namespace.

Uploads are limited to 1.5 MiB of decoded image bytes and PNG, JPEG, GIF, or WebP.
The server validates encoding, image signature, and SHA-256. Upload failure stops
the model request; there is no inline retry path or replacement image.

Up to four distinct images upload concurrently; repeated images share one upload.
Each upload has a one-minute timeout and honors user cancellation. Longer histories
can take more than one minute overall. The final payload preserves image order and
checks that every signed URL still has five minutes of lifetime before dispatch.
If a batch outlives that margin, retrying renews stale URLs and reuses live ones.

Managed runtime key revocation purges its image namespace, and ending a hosted
session with shared credentials purges only that native session's directory.
Standalone sessions using long-lived keys currently retain their artifacts;
presigned URL expiry does not delete stored bytes. Immediate replica cleanup
cannot guarantee removal of delayed S3 replication. Age-based retention and
replica reconciliation are tracked in CD-1792.

The inline-image budget is bypassed for the built-in Case.dev and Casemark Core
chat-completion providers. Other provider transports retain their existing limit.
Signed-URL renewal can affect provider prompt caching; measure cache behavior
with the target provider rather than assuming URL renewal is cache-neutral.

Deploy the router endpoint before releasing this Linc change. Native Vault image
tools are tracked separately in CD-1790. This change does not change document
rendering or layout-verification instructions.
For rollback, restore the prior Linc package or hosted runtime image; leave the
router endpoint deployed until every client using this transport has been rolled
back. Upload failures continue to stop dispatch without sending inline bytes.
