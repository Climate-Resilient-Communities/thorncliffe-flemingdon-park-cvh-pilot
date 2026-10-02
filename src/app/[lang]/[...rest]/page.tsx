import { notFound } from "next/navigation";

// Every path under a language that has no page of its own (the navigation's destinations until their stories land,
// a mistyped link) is a 404 that [lang]/not-found.tsx draws inside the resident shell, in the language of the URL.
// The layout's dynamicParams = false is about the language; the rest of the path is any path, rendered on request.
export const dynamicParams = true;

export default function UnknownResidentPath(): never {
  notFound();
}
