const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Path ids are uuid columns. Postgres raises an error for a malformed uuid, which would surface
 * as a 500, so lookups check the shape first and answer 404 like any other unknown id.
 */
export const isUuid = (value: string): boolean => UUID.test(value);
