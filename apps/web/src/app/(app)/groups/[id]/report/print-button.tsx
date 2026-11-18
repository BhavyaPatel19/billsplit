"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

/** The browser's print dialog, where "Save as PDF" makes the PDF version. */
export function PrintButton() {
  return (
    <Button variant="secondary" onClick={() => window.print()}>
      <Printer className="size-4" aria-hidden /> Print or save as PDF
    </Button>
  );
}
