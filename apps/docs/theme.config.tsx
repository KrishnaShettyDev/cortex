import { DocsThemeConfig } from 'nextra-theme-docs';

const config: DocsThemeConfig = {
  logo: <span style={{ fontWeight: 700 }}>Cortex</span>,
  project: {
    link: 'https://github.com/anthropics/cortex',
  },
  docsRepositoryBase: 'https://github.com/anthropics/cortex/tree/main/apps/docs',
  footer: {
    text: 'Cortex Memory Infrastructure',
  },
  useNextSeoProps() {
    return {
      titleTemplate: '%s – Cortex Docs',
    };
  },
  head: (
    <>
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <meta name="description" content="Cortex - Memory infrastructure for AI agents" />
      <meta name="og:title" content="Cortex Documentation" />
    </>
  ),
  primaryHue: 250,
  sidebar: {
    defaultMenuCollapseLevel: 1,
    toggleButton: true,
  },
  toc: {
    backToTop: true,
  },
  editLink: {
    text: 'Edit this page on GitHub',
  },
  feedback: {
    content: null,
  },
};

export default config;
