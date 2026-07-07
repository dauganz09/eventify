import { Badge } from "@/components/ui/badge";

export function ReadinessBadge({ isReady }: { isReady: boolean }) {
  return (
    <Badge variant={isReady ? "default" : "secondary"}>
      {isReady ? "Ready" : "Incomplete"}
    </Badge>
  );
}
