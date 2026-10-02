import { Stack } from "@/ui";

/** The translations a release held back because the English changed, every one, by provider and language. */
export function StaleList({ heading, items, testId }: { heading: string; items: string[]; testId: string }) {
  return (
    <Stack gap="label" testId={testId}>
      <p>{heading}</p>
      <Stack gap="subline" as="ul">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </Stack>
    </Stack>
  );
}
