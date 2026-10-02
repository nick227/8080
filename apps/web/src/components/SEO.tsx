import { Helmet } from 'react-helmet-async';

interface SEOProps {
  title: string;
  description?: string;
  type?: string;
  name?: string;
}

export function SEO({ title, description, type = 'website', name = 'Voice Chat' }: SEOProps) {
  return (
    <Helmet>
      { /* Standard metadata tags */ }
      <title>{title}</title>
      {description && <meta name="description" content={description} />}
      
      { /* OpenGraph tags */ }
      <meta property="og:type" content={type} />
      <meta property="og:title" content={title} />
      {description && <meta property="og:description" content={description} />}
      
      { /* Twitter tags */ }
      <meta name="twitter:creator" content={name} />
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={title} />
      {description && <meta name="twitter:description" content={description} />}
    </Helmet>
  );
}
