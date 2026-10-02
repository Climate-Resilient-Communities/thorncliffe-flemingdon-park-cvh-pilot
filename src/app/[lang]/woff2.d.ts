declare module "*.woff2" {
  /** The URL of a font file that Next bundles and serves from the app's own origin. */
  const src: string | { src: string };
  export default src;
}
