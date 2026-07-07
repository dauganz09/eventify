"use client";

import { useSyncExternalStore } from "react";
import { Input } from "@/components/ui/input";
import { toDatetimeLocal } from "@/lib/events/format";

/**
 * A `datetime-local` input showing the browser's local wall-clock time.
 *
 * `toDatetimeLocal` uses local-timezone Date methods, so it yields a different
 * string on the server (UTC) than in the browser. Rendering that as an
 * uncontrolled `defaultValue` causes a hydration mismatch and Base UI's
 * "changing the default value of an uncontrolled FieldControl" warning.
 *
 * Fix: render empty on the server and during hydration (so the markup matches),
 * then — once hydrated — render a *fresh* input (via the `key` flip) whose
 * defaultValue is the local time. Because the populated input is a brand-new
 * instance, no single FieldControl ever sees its default value change.
 *
 * `useSyncExternalStore` gives a hydration-safe boolean without calling
 * setState inside an effect.
 */
const subscribe = () => () => {};

export function DateTimeLocalInput({
  id,
  name,
  iso,
}: {
  id: string;
  name: string;
  /** ISO timestamp (UTC) or empty string. */
  iso: string;
}) {
  const hydrated = useSyncExternalStore(
    subscribe,
    () => true, // client
    () => false, // server + during hydration
  );

  return (
    <Input
      key={hydrated ? "client" : "server"}
      id={id}
      name={name}
      type="datetime-local"
      defaultValue={hydrated && iso ? toDatetimeLocal(iso) : ""}
    />
  );
}
