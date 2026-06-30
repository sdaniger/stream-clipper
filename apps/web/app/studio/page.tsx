import StudioClient from "./StudioClient";
import ErrorBoundary from "@/components/ErrorBoundary";

export const metadata = {
  title: "Stream Clipper Studio",
  description: "Twitch VOD highlight studio with candidate review and clip generation",
};

export default function StudioPage() {
  return (
    <ErrorBoundary>
      <StudioClient />
    </ErrorBoundary>
  );
}
