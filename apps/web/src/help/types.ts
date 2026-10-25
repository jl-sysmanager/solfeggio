/** Artículo de ayuda contextual ligado a una zona de la aplicación. */
export interface HelpSection {
  heading: string;
  paragraphs?: string[];
  bullets?: string[];
}

export interface HelpArticle {
  id: string;
  title: string;
  summary: string;
  sections: HelpSection[];
}
