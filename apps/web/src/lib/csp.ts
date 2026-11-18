/**
 * Content-Security-Policy for every page. Scripts need this request's nonce ('strict-dynamic'
 * lets Next.js load its chunks from them), so injected markup cannot run script. Receipt images
 * and uploads go straight to S3 with presigned URLs, so that origin is allowed for images and
 * connections. Development adds what React Refresh needs (eval and the HMR websocket).
 */
export function buildCsp({
  nonce,
  dev,
  receiptsOrigin,
}: {
  nonce: string;
  dev: boolean;
  receiptsOrigin?: string | undefined;
}): string {
  const s3 = receiptsOrigin ? ` ${receiptsOrigin}` : "";
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    // Tailwind and Next.js set some inline styles; styles cannot run script.
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob:${s3}`,
    "font-src 'self'",
    `connect-src 'self'${s3}${dev ? " ws:" : ""}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    ...(dev ? [] : ["upgrade-insecure-requests"]),
  ];
  return directives.join("; ");
}
