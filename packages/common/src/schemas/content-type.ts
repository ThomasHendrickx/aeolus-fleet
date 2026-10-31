/** A content type's essence: media types compare without case and without their parameters (RFC 9110). */
export function essenceOf(contentType: string): string {
  const [essence = ''] = contentType.split(';');
  return essence.trim().toLowerCase();
}
