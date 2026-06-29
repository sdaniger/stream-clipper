import ClipsGallery from "./ClipsGallery";

export const metadata = {
  title: "Saved Clips - Stream Clipper",
  description: "Browse generated clips with comment overlays",
};

export default function ClipsPage() {
  return (
    <div className="min-h-screen bg-[#050816] px-4 py-6 sm:px-6">
      <div className="mx-auto max-w-5xl">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-lg font-semibold text-white">Saved Clips</h1>
          <a href="/" className="text-xs text-slate-400 hover:text-slate-200 transition">
            ← Back to main
          </a>
        </div>
        <ClipsGallery />
      </div>
    </div>
  );
}
