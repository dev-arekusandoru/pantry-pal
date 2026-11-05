import { themes as prismThemes } from 'prism-react-renderer';

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: 'PantryPal',
  tagline: 'Plan meals. Track food. Shop for what you need.',
  url: 'https://dev-arekusandoru.github.io',
  baseUrl: '/pantry-pal/',
  organizationName: 'dev-arekusandoru',
  projectName: 'pantry-pal',
  trailingSlash: true,
  onBrokenLinks: 'throw',
  onBrokenAnchors: 'throw',
  markdown: {
    mermaid: true,
    hooks: {
      onBrokenMarkdownLinks: 'throw',
      onBrokenMarkdownImages: 'throw',
    },
  },
  themes: ['@docusaurus/theme-mermaid'],
  presets: [
    ['classic', {
      docs: {
        path: '../docs',
        routeBasePath: '/',
        sidebarPath: './sidebars.js',
        editUrl: 'https://github.com/dev-arekusandoru/pantry-pal/edit/main/docs/',
      },
      blog: false,
      pages: false,
      theme: { customCss: './src/css/custom.css' },
    }],
  ],
  themeConfig: {
    colorMode: { respectPrefersColorScheme: true },
    navbar: {
      title: 'PantryPal docs',
      items: [
        { type: 'doc', docId: 'start/install', label: 'Install', position: 'left' },
        { href: 'https://github.com/dev-arekusandoru/pantry-pal', label: 'GitHub', position: 'right' },
      ],
    },
    footer: {
      links: [
        { label: 'Contribute', to: '/develop/contributing' },
        { label: 'License', href: 'https://github.com/dev-arekusandoru/pantry-pal/blob/main/LICENSE' },
      ],
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['bash', 'json', 'json5', 'yaml', 'diff'],
    },
  },
};

export default config;
