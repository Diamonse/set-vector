import { CdjLoader } from "@/components/loading/cdj-loader";

export default function Loading() {
  return (
    <div className="grid min-h-[60vh] animate-[fade-in_400ms_ease-out_150ms_both] place-items-center content-center">
      <CdjLoader />
    </div>
  );
}
