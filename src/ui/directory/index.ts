// The resident directory's import surface (S02.06): app code imports from "@/ui/directory". Separate from "@/ui" for the
// same reason as "@/ui/choices": these pull in Next's link component, next-intl and the phone's storage.
export { DirectoryBrowser } from "./directory-browser";
export { ProviderPage } from "./provider-page";
