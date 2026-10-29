/*
 * fumadocs-core's search declarations import the types of every hosted provider it supports
 * (Algolia, Orama Cloud, Meilisearch, Mixedbread). The site uses the static index only and
 * installs none of them; these stand-ins keep `skipLibCheck: false` working.
 */
declare module 'algoliasearch' {
  export type Algoliasearch = unknown;
}
declare module 'algoliasearch/lite' {
  export type LiteClient = unknown;
  export type SearchResponse<T = unknown> = { hits: T[] };
}
declare module '@orama/core' {
  export type OramaCloud = unknown;
  export type OramaCloudSearchParams = Record<string, unknown>;
}
declare module '@oramacloud/client' {
  export type OramaClient = unknown;
  export type ClientSearchParams = Record<string, unknown>;
}
declare module 'meilisearch' {
  export type Meilisearch = unknown;
}
declare module '@mixedbread/sdk' {
  type Mixedbread = unknown;
  export default Mixedbread;
}
declare module '@mixedbread/sdk/resources/stores' {
  export type ScoredTextInputChunk = unknown;
}
