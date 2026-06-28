import StudioClient from "./StudioClient";

export const metadata = {
  title: "Stream Clipper Studio",
  description: "Twitch VOD highlight studio with candidate review and clip generation",
};

export default function StudioPage() {
  return <StudioClient />;
}
