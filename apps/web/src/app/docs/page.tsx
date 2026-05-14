import { Card, CardBody, Stack } from "@repo/adricore/blocks";
import type { Metadata } from "next";
import Link from "next/link";

import { DOCS_INDEX } from "@/lib/docs/registry";

export const metadata: Metadata = {
  title: "Documentation | Trade Agent",
  description: "In-app documentation for Trade Agent.",
};

export default function DocsHomePage() {
  return (
    <div className="bk-container bk-container_lg bk-scroll-region flex-1 overflow-auto py-6">
      <Stack gap="lg">
        <div>
          <h1 className="bk-page-header_title">Documentation</h1>
          <p className="bk-page-header_subtitle">Concepten en datastromen in deze applicatie. Kies een onderwerp hieronder.</p>
        </div>

        <Card>
          <CardBody>
            <ul className="bk-stack bk-stack_gap-md" style={{ margin: 0, listStyle: "none", padding: 0 }}>
              {DOCS_INDEX.map((doc) => (
                <li key={doc.slug}>
                  <Link href={`/docs/${doc.slug}`} className="bk-link font-medium">
                    {doc.title}
                  </Link>
                  <p className="bk-text-muted mt-1 text-sm" style={{ marginBottom: 0 }}>
                    {doc.description}
                  </p>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      </Stack>
    </div>
  );
}
