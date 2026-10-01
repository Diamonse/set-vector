import { CdjLoader } from "@/components/loading/cdj-loader";

export default function Loading() {
  return (
    <div className="grid min-h-[60vh] animate-[fade-in_400ms_ease-out_150ms_both] place-items-center content-center gap-4">
      <CdjLoader />
      <p role="status" className="text-ui text-muted">
        Cueing up the page…
      </p>
    </div>
  );
}
