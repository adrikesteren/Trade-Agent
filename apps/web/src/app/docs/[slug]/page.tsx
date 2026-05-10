import { PageHeader, Stack } from "@repo/blocks";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SignalsToPositionArticle } from "@/lib/docs/articles/signals-to-position-content";
import { DOC_SLUGS, getDocMeta, isDocSlug } from "@/lib/docs/registry";

type PageProps = { params: Promise<{ slug: string }> };

export function generateStaticParams(): { slug: string }[] {
  return DOC_SLUGS.map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const meta = getDocMeta(slug);
  if (!meta) {
    return { title: "Documentation | Trade Agent" };
  }
  return {
    title: `${meta.title} | Trade Agent`,
    description: meta.description,
  };
}

function DocArticleBody({ slug }: { slug: string }) {
  if (slug === "signals-to-position") {
    return <SignalsToPositionArticle />;
  }
  return null;
}

export default async function DocArticlePage({ params }: PageProps) {
  const { slug } = await params;
  if (!isDocSlug(slug)) {
    notFound();
  }

  const meta = getDocMeta(slug);
  if (!meta) {
    notFound();
  }

  return (
    <div className="bk-container bk-container_lg bk-scroll-region flex-1 overflow-auto py-6">
      <Stack gap="lg">
        <div>
          <p className="mb-2 text-xs">
            <Link href="/docs" className="bk-link">
              ← Documentation
            </Link>
          </p>
          <PageHeader title={meta.title} subtitle={meta.description} />
        </div>
        <DocArticleBody slug={slug} />
      </Stack>
    </div>
  );
}
