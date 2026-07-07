import { redirect } from "next/navigation";

export default async function BuilderIndexPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  redirect(`/events/${eventId}/builder/details`);
}
