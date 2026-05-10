export const DOC_SLUGS = ["signals-to-position"] as const;

export type DocSlug = (typeof DOC_SLUGS)[number];

export type DocMeta = {
  slug: DocSlug;
  title: string;
  description: string;
};

export const DOCS_INDEX: DocMeta[] = [
  {
    slug: "signals-to-position",
    title: "Van signalen tot positie",
    description:
      "End-to-end pipeline: candles, signal agents, mediator, trade decisions, executor, orders, fills en posities — inclusief scheduling en saldo.",
  },
];

export function isDocSlug(value: string): value is DocSlug {
  return (DOC_SLUGS as readonly string[]).includes(value);
}

export function getDocMeta(slug: string): DocMeta | undefined {
  return DOCS_INDEX.find((d) => d.slug === slug);
}
