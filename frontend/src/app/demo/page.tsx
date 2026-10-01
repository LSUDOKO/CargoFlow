import type { Metadata } from "next";
import { Suspense } from "react";
import { DemoRunner } from "@/components/demo/DemoRunner";

export const metadata: Metadata = { title: "Live demo" };

export default function DemoPage() {
  // useSearchParams (the run id lives in ?id=) needs a Suspense boundary in the App Router
  return (
    <Suspense>
      <DemoRunner />
    </Suspense>
  );
}
